import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { TelemetryService, deriveTelemetryStatus } from "../electron/telemetry-service.ts";
import type { TerminalTelemetrySnapshot } from "../shared/telemetry.ts";

function createRepoFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath, encoding: "utf-8" });
  execFileSync("git", ["config", "user.name", "Telemetry Test"], { cwd: repoPath, encoding: "utf-8" });
  execFileSync("git", ["config", "user.email", "telemetry@example.com"], { cwd: repoPath, encoding: "utf-8" });
  fs.writeFileSync(path.join(repoPath, "README.md"), "hello\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath, encoding: "utf-8" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath, encoding: "utf-8" });
  return repoPath;
}

test("deriveTelemetryStatus marks awaiting_contract after turn completion", () => {
  const status = deriveTelemetryStatus({
    terminal_id: "terminal-1",
    worktree_path: "/tmp/project",
    provider: "codex",
    handoff_id: "handoff-1",
    session_attached: true,
    session_attach_confidence: "medium",
    turn_state: "turn_complete",
    pty_alive: true,
    descendant_processes: [],
    done_exists: false,
    result_exists: false,
    derived_status: "starting",
  });

  assert.equal(status, "awaiting_contract");
});

test("telemetry service updates meaningful progress from token growth and process changes", () => {
  let nowMs = Date.parse("2026-03-26T00:00:00.000Z");
  const service = new TelemetryService({
    now: () => nowMs,
    processPollIntervalMs: 0,
    stallThresholdMs: 30_000,
  });

  service.registerTerminal({
    terminalId: "terminal-1",
    worktreePath: "/tmp/project",
    provider: "codex",
  });
  service.recordPtyCreated({ terminalId: "terminal-1", ptyId: 7, shellPid: 100 });
  service.recordSessionAttached({
    terminalId: "terminal-1",
    provider: "codex",
    sessionId: "session-1",
    confidence: "medium",
  });
  service.recordSessionTelemetry("terminal-1", [
    {
      at: "2026-03-26T00:00:01.000Z",
      event_type: "token_count",
      token_total: 50,
      turn_state: "in_turn",
    },
  ]);

  let snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.last_meaningful_progress_at, "2026-03-26T00:00:01.000Z");

  service.recordSessionTelemetry("terminal-1", [
    {
      at: "2026-03-26T00:00:02.000Z",
      event_type: "token_count",
      token_total: 50,
      turn_state: "in_turn",
    },
  ]);
  snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.last_meaningful_progress_at, "2026-03-26T00:00:01.000Z");

  service.recordProcessSnapshot("terminal-1", {
    descendantProcesses: [
      { pid: 200, command: "codex", cli_type: "codex" },
      { pid: 300, command: "npm run build", cli_type: null },
    ],
    foregroundTool: "npm run build",
  }, "2026-03-26T00:00:03.000Z");

  snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.foreground_tool, "npm run build");
  assert.equal(snapshot?.last_meaningful_progress_at, "2026-03-26T00:00:03.000Z");

  nowMs = Date.parse("2026-03-26T00:00:04.000Z");
  snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.derived_status, "progressing");
});

test("telemetry service keeps a bounded event ring", () => {
  const service = new TelemetryService({ eventLimit: 3 });
  service.registerTerminal({
    terminalId: "terminal-1",
    worktreePath: "/tmp/project",
  });

  service.recordPtyCreated({ terminalId: "terminal-1", ptyId: 1 });
  service.recordPtyInput("terminal-1", "a", "2026-03-26T00:00:01.000Z");
  service.recordPtyOutput("terminal-1", "b", "2026-03-26T00:00:02.000Z");
  service.recordPtyExit("terminal-1", 0, "2026-03-26T00:00:03.000Z");

  const page = service.listTerminalEvents({ terminalId: "terminal-1", limit: 10 });
  assert.equal(page.events.length, 3);
  assert.equal(page.events[0].kind, "pty_input");
  assert.equal(page.events.at(-1)?.kind, "pty_exit");
});

test("telemetry service ignores stale PTY exits after a terminal respawns", () => {
  const service = new TelemetryService({ processPollIntervalMs: 0 });
  service.registerTerminal({
    terminalId: "terminal-1",
    worktreePath: "/tmp/project",
    provider: "claude",
  });

  service.recordPtyCreated({ terminalId: "terminal-1", ptyId: 1, shellPid: 100 });
  service.recordPtyCreated({ terminalId: "terminal-1", ptyId: 2, shellPid: 200 });
  service.recordPtyExitByPtyId(1, 0, "2026-03-26T00:00:03.000Z");

  let snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.pty_alive, true);
  assert.notEqual(snapshot?.derived_status, "exited");

  service.recordPtyExitByPtyId(2, 0, "2026-03-26T00:00:04.000Z");
  snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.pty_alive, false);
  assert.equal(snapshot?.derived_status, "exited");
});

test("workflow snapshot reads contract truth from Hydra handoff artifacts", () => {
  const repoPath = createRepoFixture();
  try {
    const workflowId = "workflow-telemetry";
    const handoffId = "handoff-telemetry";
    const workflowDir = path.join(repoPath, ".hydra", "workflows", workflowId);
    const artifactsDir = path.join(workflowDir, handoffId);
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.mkdirSync(path.join(repoPath, ".hydra", "handoffs"), { recursive: true });

    const resultFile = path.join(artifactsDir, "result.json");
    const doneFile = path.join(artifactsDir, "done");
    const handoffFile = path.join(artifactsDir, "handoff.json");
    const taskFile = path.join(artifactsDir, "task.md");
    fs.writeFileSync(taskFile, "# Task\n", "utf-8");

    const handoff = {
      id: handoffId,
      created_at: "2026-03-26T00:00:00.000Z",
      workflow_id: workflowId,
      worktree_path: repoPath,
      from: { role: "planner", agent_type: "codex", agent_id: "parent" },
      to: { role: "implementer", agent_type: "codex", agent_id: null },
      task: {
        type: "code-change-task",
        title: "Implement telemetry",
        description: "Implement telemetry",
        acceptance_criteria: ["done"],
      },
      context: {
        files: [],
        previous_handoffs: [],
      },
      artifacts: {
        package_dir: artifactsDir,
        handoff_file: handoffFile,
        task_file: taskFile,
        result_file: resultFile,
        done_file: doneFile,
      },
      status: "in_progress",
      retry_count: 1,
      max_retries: 3,
      timeout_minutes: 15,
      dispatch: {
        active_terminal_id: "terminal-1",
        attempts: [{
          attempt: 1,
          terminal_id: "terminal-1",
          agent_type: "codex",
          prompt: "prompt",
          started_at: "2026-03-26T00:00:00.000Z",
        }],
      },
    };
    fs.writeFileSync(path.join(repoPath, ".hydra", "handoffs", `${handoffId}.json`), JSON.stringify(handoff, null, 2), "utf-8");
    fs.writeFileSync(handoffFile, JSON.stringify(handoff, null, 2), "utf-8");

    const workflow = {
      id: workflowId,
      template: "single-step",
      task: "Implement telemetry",
      repo_path: repoPath,
      worktree_path: repoPath,
      branch: null,
      base_branch: "main",
      own_worktree: false,
      agent_type: "codex",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
      status: "running",
      current_handoff_id: handoffId,
      handoff_ids: [handoffId],
      timeout_minutes: 15,
      max_retries: 3,
      auto_approve: false,
    };
    fs.writeFileSync(path.join(workflowDir, "workflow.json"), JSON.stringify(workflow, null, 2), "utf-8");

    fs.writeFileSync(resultFile, JSON.stringify({
      success: true,
      summary: "done",
      handoff_id: handoffId,
      workflow_id: workflowId,
      outputs: [],
      evidence: [],
      next_action: { type: "complete", reason: "done" },
    }, null, 2), "utf-8");
    fs.writeFileSync(doneFile, JSON.stringify({
      version: "hydra/v2",
      handoff_id: handoffId,
      workflow_id: workflowId,
      result_file: resultFile,
    }, null, 2), "utf-8");

    const service = new TelemetryService();
    service.registerTerminal({
      terminalId: "terminal-1",
      worktreePath: repoPath,
      provider: "codex",
      workflowId,
      handoffId,
      repoPath,
    });
    service.recordPtyCreated({ terminalId: "terminal-1", ptyId: 10 });
    service.recordSessionAttached({
      terminalId: "terminal-1",
      provider: "codex",
      sessionId: "session-1",
      confidence: "medium",
    });
    service.recordSessionTelemetry("terminal-1", [{
      at: "2026-03-26T00:00:05.000Z",
      event_type: "task_complete",
      turn_state: "turn_complete",
      meaningful_progress: true,
    }]);

    const workflowSnapshot = service.getWorkflowSnapshot(repoPath, workflowId);
    assert.ok(workflowSnapshot);
    assert.equal(workflowSnapshot?.contract.result_exists, true);
    assert.equal(workflowSnapshot?.contract.done_valid, true);
    assert.equal(workflowSnapshot?.retry_budget.remaining, 2);
    assert.equal(workflowSnapshot?.terminal?.result_exists, true);
    assert.equal(workflowSnapshot?.terminal?.done_exists, true);
    service.dispose();
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("deriveTelemetryStatus decays active turn_state to stall_candidate after 4x threshold", () => {
  const stallThresholdMs = 45_000;
  const base: TerminalTelemetrySnapshot = {
    terminal_id: "terminal-1",
    worktree_path: "/tmp/project",
    provider: "claude",
    session_attached: true,
    session_attach_confidence: "medium",
    turn_state: "thinking",
    pty_alive: true,
    descendant_processes: [],
    done_exists: false,
    result_exists: false,
    derived_status: "starting",
    last_meaningful_progress_at: "2026-03-26T00:00:00.000Z",
    last_output_at: "2026-03-26T00:00:01.000Z",
  };

  // Within 4x threshold: still progressing
  const withinDecay = deriveTelemetryStatus(
    base,
    Date.parse("2026-03-26T00:02:00.000Z"), // 120s < 180s
    stallThresholdMs,
  );
  assert.equal(withinDecay, "progressing");

  // Past 4x threshold: turn_state is stale, should become stall_candidate
  const pastDecay = deriveTelemetryStatus(
    base,
    Date.parse("2026-03-26T00:04:00.000Z"), // 240s > 180s
    stallThresholdMs,
  );
  assert.equal(pastDecay, "stall_candidate");

  // Same for tool_running
  const toolRunning = deriveTelemetryStatus(
    { ...base, turn_state: "tool_running" },
    Date.parse("2026-03-26T00:04:00.000Z"),
    stallThresholdMs,
  );
  assert.equal(toolRunning, "stall_candidate");

  // Same for tool_pending
  const toolPending = deriveTelemetryStatus(
    { ...base, turn_state: "tool_pending" },
    Date.parse("2026-03-26T00:04:00.000Z"),
    stallThresholdMs,
  );
  assert.equal(toolPending, "stall_candidate");

  // Without last_meaningful_progress_at: still progressing (no decay possible)
  const noProgress = deriveTelemetryStatus(
    { ...base, last_meaningful_progress_at: undefined },
    Date.parse("2026-03-26T00:04:00.000Z"),
    stallThresholdMs,
  );
  assert.equal(noProgress, "progressing");
});
