import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseWatchArgs, watchAgent, type AgentStatusView } from "../src/watch.ts";
import type { AgentRecord } from "../src/store.ts";

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

test("parseWatchArgs throws when neither --agent nor --workflow", () => {
  assert.throws(
    () => parseWatchArgs(["--repo", "/tmp"]),
    /Missing required flag: --workflow or --agent/,
  );
});

test("parseWatchArgs throws when --workflow without --repo", () => {
  assert.throws(
    () => parseWatchArgs(["--workflow", "wf-1"]),
    /Missing required flag: --repo/,
  );
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

function makeTestAgent(dir: string): { agent: AgentRecord; contractPath: string } {
  const agentId = "hydra-test-watch";
  const workflowId = `workflow-${agentId}`;
  const handoffId = `handoff-${agentId}`;
  const packageDir = path.join(dir, ".hydra", "workflows", workflowId, handoffId);
  fs.mkdirSync(packageDir, { recursive: true });

  const contract = {
    version: "hydra/v2",
    handoff_id: handoffId,
    workflow_id: workflowId,
    created_at: new Date().toISOString(),
    from: { role: "planner", agent_type: "claude", agent_id: "parent" },
    to: { role: "implementer", agent_type: "claude", agent_id: null },
    task: {
      type: "code-change-task",
      title: "Test task",
      description: "Do something",
      acceptance_criteria: ["Pass"],
    },
    context: { files: [], previous_handoffs: [] },
    artifacts: {
      package_dir: packageDir,
      handoff_file: path.join(packageDir, "handoff.json"),
      task_file: path.join(packageDir, "task.md"),
      result_file: path.join(packageDir, "result.json"),
      done_file: path.join(packageDir, "done"),
    },
  };
  fs.writeFileSync(contract.artifacts.handoff_file, JSON.stringify(contract));

  const agent: AgentRecord = {
    id: agentId,
    task: "Test task",
    type: "claude",
    workflowId,
    handoffId,
    repo: dir,
    terminalId: "tc-test-001",
    worktreePath: dir,
    branch: `hydra/${agentId}`,
    baseBranch: "main",
    ownWorktree: true,
    taskFile: contract.artifacts.task_file,
    handoffFile: contract.artifacts.handoff_file,
    resultFile: contract.artifacts.result_file,
    doneFile: contract.artifacts.done_file,
    createdAt: new Date().toISOString(),
  };

  return { agent, contractPath: packageDir };
}

test("watchAgent returns AGENT_NOT_FOUND for unknown agent", async () => {
  const result = await watchAgent(
    { agentId: "hydra-nonexistent", intervalMs: 100, timeoutMs: 500 },
    { loadAgent: () => null },
  );
  assert.equal(result.agent.status, "failed");
  assert.equal(result.failure?.code, "AGENT_NOT_FOUND");
});

test("watchAgent detects completed agent via done + result files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-watch-"));
  const { agent, contractPath } = makeTestAgent(dir);

  const resultContract = {
    version: "hydra/v2",
    handoff_id: agent.handoffId,
    workflow_id: agent.workflowId,
    success: true,
    summary: "All good",
    outputs: [],
    evidence: ["test"],
    next_action: { type: "complete", reason: "Done" },
  };
  fs.writeFileSync(
    path.join(contractPath, "result.json"),
    JSON.stringify(resultContract),
  );
  fs.writeFileSync(
    path.join(contractPath, "done"),
    JSON.stringify({
      version: "hydra/v2",
      handoff_id: agent.handoffId,
      workflow_id: agent.workflowId,
      result_file: path.join(contractPath, "result.json"),
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
        task_status: "running",
        task_status_source: "turn_state",
        pty_alive: true,
      }),
    },
  );

  assert.equal(result.agent.status, "running");
  assert.deepEqual(result.telemetry, {
    turn_state: "tool_running",
    foreground_tool: "Edit",
    last_meaningful_progress_at: "2026-04-01T00:00:00.000Z",
    task_status: "running",
    task_status_source: "turn_state",
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
      telemetryTerminal: () => { throw new Error("unavailable"); },
    },
  );

  assert.equal(result.agent.status, "running");
  assert.equal(result.telemetry, undefined);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("watchAgent retries after terminal death then completes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-watch-"));
  const { agent, contractPath } = makeTestAgent(dir);

  let aliveCallCount = 0;
  let dispatched = false;
  let savedAgent: typeof agent | null = null;

  const resultContract = {
    version: "hydra/v2",
    handoff_id: agent.handoffId,
    workflow_id: agent.workflowId,
    success: true,
    summary: "Retried and completed",
    outputs: [],
    evidence: ["test"],
    next_action: { type: "complete", reason: "Done" },
  };

  const result = await watchAgent(
    { agentId: agent.id, intervalMs: 10, maxRetries: 1 },
    {
      loadAgent: () => agent,
      checkTerminalAlive: () => {
        aliveCallCount++;
        if (aliveCallCount === 1) return false; // first check: dead
        // After retry dispatch, write result + done to simulate completion
        if (!dispatched) return true;
        fs.writeFileSync(
          path.join(contractPath, "result.json"),
          JSON.stringify(resultContract),
        );
        fs.writeFileSync(
          path.join(contractPath, "done"),
          JSON.stringify({
            version: "hydra/v2",
            handoff_id: agent.handoffId,
            workflow_id: agent.workflowId,
            result_file: path.join(contractPath, "result.json"),
          }),
        );
        return true;
      },
      sleep: () => Promise.resolve(),
      dispatchCreateOnly: async () => {
        dispatched = true;
        return {
          projectId: "proj-1",
          terminalId: "tc-retried-001",
          terminalType: "claude",
          terminalTitle: "Retried",
          prompt: "retry prompt",
        };
      },
      saveAgent: (record) => { savedAgent = record as typeof agent; },
    },
  );

  assert.equal(result.agent.status, "completed");
  assert.equal(result.result?.summary, "Retried and completed");
  assert.equal(dispatched, true);
  assert.equal(savedAgent?.terminalId, "tc-retried-001");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("watchAgent fails after max retries exceeded", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-watch-"));
  const { agent } = makeTestAgent(dir);

  let dispatchCount = 0;

  const result = await watchAgent(
    { agentId: agent.id, intervalMs: 10, maxRetries: 2 },
    {
      loadAgent: () => agent,
      checkTerminalAlive: () => false,
      sleep: () => Promise.resolve(),
      dispatchCreateOnly: async () => {
        dispatchCount++;
        return {
          projectId: "proj-1",
          terminalId: `tc-retry-${dispatchCount}`,
          terminalType: "claude",
          terminalTitle: "Retried",
          prompt: "retry prompt",
        };
      },
      saveAgent: () => {},
    },
  );

  assert.equal(result.agent.status, "failed");
  assert.equal(result.failure?.code, "AGENT_TERMINAL_DEAD");
  assert.match(result.failure!.message, /retries exhausted: 2\/2/);
  assert.equal(dispatchCount, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});
