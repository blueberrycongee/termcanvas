import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseWatchArgs, watchAgent } from "../src/watch.ts";
import { AGENT_STORE_SCHEMA_VERSION, type AgentRecord } from "../src/store.ts";
import { WORKFLOW_RESULT_SCHEMA_VERSION } from "../src/protocol.ts";
import { getRunResultFile, getRunTaskFile } from "../src/layout.ts";

test("parseWatchArgs accepts --agent without --repo", () => {
  const args = parseWatchArgs(["--agent", "hydra-abc123"]);
  assert.equal(args.agent, "hydra-abc123");
  assert.equal(args.repo, undefined);
  assert.equal(args.workflow, undefined);
});

test("parseWatchArgs accepts --workflow with --repo", () => {
  const args = parseWatchArgs(["--workflow", "wf-1", "--repo", "/tmp"]);
  assert.equal(args.workflow, "wf-1");
  assert.equal(args.repo, "/tmp");
});

test("parseWatchArgs leaves routing validation to watch()", () => {
  const args = parseWatchArgs(["--repo", "/tmp"]);
  assert.equal(args.agent, undefined);
  assert.equal(args.workflow, undefined);
  assert.equal(args.repo, "/tmp");
});

test("parseWatchArgs accepts workflow without repo and lets watch() enforce the pair", () => {
  const args = parseWatchArgs(["--workflow", "wf-1"]);
  assert.equal(args.workflow, "wf-1");
  assert.equal(args.repo, undefined);
});

test("parseWatchArgs respects --interval-ms and --timeout-ms", () => {
  const args = parseWatchArgs([
    "--agent", "hydra-abc",
    "--interval-ms", "5000",
    "--timeout-ms", "60000",
  ]);
  assert.equal(args.intervalMs, 5000);
  assert.equal(args.timeoutMs, 60000);
});

function makeTestAgent(dir: string): { agent: AgentRecord; resultFile: string } {
  const agentId = "hydra-test-watch";
  const workflowId = `workflow-${agentId}`;
  const assignmentId = `assignment-${agentId}`;
  const runId = `run-${agentId}`;
  const taskFile = getRunTaskFile(dir, workflowId, assignmentId, runId);
  const resultFile = getRunResultFile(dir, workflowId, assignmentId, runId);
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, "# Task\n", "utf-8");

  const agent: AgentRecord = {
    schema_version: AGENT_STORE_SCHEMA_VERSION,
    id: agentId,
    task: "Test task",
    type: "claude",
    workflowId,
    assignmentId,
    runId,
    repo: dir,
    terminalId: "tc-test-001",
    worktreePath: dir,
    branch: `hydra/${agentId}`,
    baseBranch: "main",
    ownWorktree: true,
    taskFile,
    resultFile,
    createdAt: new Date().toISOString(),
  };

  return { agent, resultFile };
}

test("watchAgent returns AGENT_NOT_FOUND for unknown agent", async () => {
  const result = await watchAgent(
    { agentId: "hydra-nonexistent", intervalMs: 100, timeoutMs: 500 },
    { loadAgent: () => null },
  );
  assert.equal(result.agent.status, "failed");
  assert.equal(result.failure?.code, "AGENT_NOT_FOUND");
});

test("watchAgent detects completed agent via result.json", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-watch-"));
  const { agent, resultFile } = makeTestAgent(dir);

  fs.writeFileSync(
    resultFile,
    JSON.stringify({
      schema_version: WORKFLOW_RESULT_SCHEMA_VERSION,
      workflow_id: agent.workflowId,
      assignment_id: agent.assignmentId,
      run_id: agent.runId,
      success: true,
      summary: "All good",
      outputs: [],
      evidence: ["test"],
      next_action: { type: "complete", reason: "Done" },
    }),
  );

  const result = await watchAgent(
    { agentId: agent.id, intervalMs: 100 },
    { loadAgent: () => agent },
  );

  assert.equal(result.agent.status, "completed");
  assert.equal(result.result?.success, true);
  assert.equal(result.result?.summary, "All good");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("watchAgent detects dead terminal (no retries)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-watch-"));
  const { agent } = makeTestAgent(dir);

  const result = await watchAgent(
    { agentId: agent.id, intervalMs: 100, maxRetries: 0 },
    {
      loadAgent: () => agent,
      checkTerminalAlive: () => false,
    },
  );

  assert.equal(result.agent.status, "failed");
  assert.equal(result.failure?.code, "AGENT_TERMINAL_DEAD");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("watchAgent times out while waiting", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-watch-"));
  const { agent } = makeTestAgent(dir);

  let tick = 0;
  const baseTime = Date.now();
  const result = await watchAgent(
    { agentId: agent.id, intervalMs: 10, timeoutMs: 50 },
    {
      loadAgent: () => agent,
      checkTerminalAlive: () => true,
      now: () => new Date(baseTime + tick++ * 20).toISOString(),
      sleep: () => Promise.resolve(),
    },
  );

  assert.equal(result.agent.status, "running");
  assert.equal(result.failure, undefined);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("watchAgent retries a dead terminal onto a fresh run directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-watch-"));
  const { agent } = makeTestAgent(dir);
  const originalRunId = agent.runId!;
  const originalTaskFile = agent.taskFile!;
  const originalResultFile = agent.resultFile!;
  const dispatchRequests: Array<{ runId?: string; taskFile: string; resultFile: string }> = [];
  let aliveChecks = 0;
  let tick = 0;
  const baseTime = Date.now();

  const result = await watchAgent(
    { agentId: agent.id, intervalMs: 10, timeoutMs: 50, maxRetries: 1 },
    {
      loadAgent: () => agent,
      now: () => new Date(baseTime + tick++ * 20).toISOString(),
      sleep: () => Promise.resolve(),
      checkTerminalAlive: () => {
        aliveChecks += 1;
        return aliveChecks === 1 ? false : true;
      },
      dispatchCreateOnly: async (request) => {
        dispatchRequests.push({
          runId: request.runId,
          taskFile: request.taskFile,
          resultFile: request.resultFile,
        });
        return {
          projectId: "project-1",
          terminalId: "tc-test-002",
          terminalType: request.agentType,
          terminalTitle: request.agentType,
          prompt: `Read ${request.taskFile}`,
        };
      },
      saveAgent: (record) => {
        Object.assign(agent, record);
      },
    },
  );

  assert.equal(result.agent.status, "running");
  assert.equal(dispatchRequests.length, 1);
  assert.notEqual(dispatchRequests[0]?.runId, originalRunId);
  assert.notEqual(dispatchRequests[0]?.taskFile, originalTaskFile);
  assert.notEqual(dispatchRequests[0]?.resultFile, originalResultFile);
  assert.equal(agent.runId, dispatchRequests[0]?.runId);
  assert.equal(agent.taskFile, dispatchRequests[0]?.taskFile);
  assert.equal(agent.resultFile, dispatchRequests[0]?.resultFile);
  assert.equal(fs.existsSync(agent.taskFile!), true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("watchAgent enriches running state with telemetry", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-watch-"));
  const { agent } = makeTestAgent(dir);

  let tick = 0;
  const baseTime = Date.now();
  const result = await watchAgent(
    { agentId: agent.id, intervalMs: 10, timeoutMs: 50 },
    {
      loadAgent: () => agent,
      checkTerminalAlive: () => true,
      now: () => new Date(baseTime + tick++ * 20).toISOString(),
      sleep: () => Promise.resolve(),
      telemetryTerminal: () => ({
        turn_state: "tool_running",
        foreground_tool: "Edit",
        last_meaningful_progress_at: "2026-04-01T00:00:00.000Z",
        pty_alive: true,
      }),
    },
  );

  assert.equal(result.agent.status, "running");
  assert.deepEqual(result.telemetry, {
    turn_state: "tool_running",
    foreground_tool: "Edit",
    last_meaningful_progress_at: "2026-04-01T00:00:00.000Z",
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

test("watchAgent returns no telemetry when unavailable", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-watch-"));
  const { agent } = makeTestAgent(dir);

  let tick = 0;
  const baseTime = Date.now();
  const result = await watchAgent(
    { agentId: agent.id, intervalMs: 10, timeoutMs: 50 },
    {
      loadAgent: () => agent,
      checkTerminalAlive: () => true,
      now: () => new Date(baseTime + tick++ * 20).toISOString(),
      sleep: () => Promise.resolve(),
      telemetryTerminal: () => null,
    },
  );

  assert.equal(result.agent.status, "running");
  assert.equal(result.telemetry, undefined);

  fs.rmSync(dir, { recursive: true, force: true });
});
