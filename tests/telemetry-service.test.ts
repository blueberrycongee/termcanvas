import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { TelemetryService, deriveTelemetryStatus } from "../electron/telemetry-service.ts";
import { AssignmentManager } from "../hydra/src/assignment/manager.ts";
import { WORKFLOW_STATE_SCHEMA_VERSION, saveWorkflow } from "../hydra/src/workflow-store.ts";

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
    assignment_id: "assignment-1",
    session_attached: true,
    session_attach_confidence: "medium",
    turn_state: "turn_complete",
    pty_alive: true,
    descendant_processes: [],
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

test("workflow snapshot reads contract truth from Hydra assignment run artifacts", () => {
  const repoPath = createRepoFixture();
  try {
    const workflowId = "workflow-telemetry";
    const assignmentId = "assignment-telemetry";
    const runId = "run-telemetry";
    const taskFile = path.join(repoPath, ".hydra", "workflows", workflowId, "attempts", assignmentId, runId, "task.md");
    const resultFile = path.join(repoPath, ".hydra", "workflows", workflowId, "attempts", assignmentId, runId, "result.json");
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, "# Task\n", "utf-8");
    const manager = new AssignmentManager(repoPath, workflowId);
    manager.create({
      id: assignmentId,
      workflow_id: workflowId,
      worktree_path: repoPath,
      role: "implementer",
      kind: "single_step",
      from_assignment_id: null,
      requested_agent_type: "codex",
      timeout_minutes: 15,
      max_retries: 3,
    });
    const assignment = manager.load(assignmentId)!;
    assignment.status = "in_progress";
    assignment.retry_count = 1;
    assignment.active_run_id = runId;
    assignment.runs.push({
      id: runId,
      terminal_id: "terminal-1",
      agent_type: "codex",
      prompt: "prompt",
      task_file: taskFile,
      result_file: resultFile,
      artifact_dir: path.dirname(taskFile),
      status: "running",
      started_at: "2026-03-26T00:00:00.000Z",
    });
    manager.save(assignment);

    saveWorkflow({
      schema_version: WORKFLOW_STATE_SCHEMA_VERSION,
      id: workflowId,
      template: "single-step",
      task: "Implement telemetry",
      repo_path: repoPath,
      worktree_path: repoPath,
      branch: null,
      base_branch: "main",
      own_worktree: false,
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
      status: "running",
      current_assignment_id: assignmentId,
      assignment_ids: [assignmentId],
      timeout_minutes: 15,
      max_retries: 3,
      auto_approve: false,
    });

    fs.writeFileSync(resultFile, JSON.stringify({
      schema_version: "hydra/result/v1",
      success: true,
      summary: "done",
      workflow_id: workflowId,
      assignment_id: assignmentId,
      run_id: runId,
      outputs: [],
      evidence: [],
      next_action: { type: "complete", reason: "done" },
    }, null, 2), "utf-8");

    const service = new TelemetryService();
    service.registerTerminal({
      terminalId: "terminal-1",
      worktreePath: repoPath,
      provider: "codex",
      workflowId,
      assignmentId,
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
    assert.equal(workflowSnapshot?.retry_budget.remaining, 2);
    assert.equal(workflowSnapshot?.terminal?.result_exists, true);
    service.dispose();
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
