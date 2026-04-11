import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  TelemetryService,
  deriveTelemetryStatus,
  deriveTelemetryTaskStatus,
} from "../electron/telemetry-service.ts";

function createRepoFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-repo-"));
  execFileSync("git", ["init", "-b", "main"], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  execFileSync("git", ["config", "user.name", "Telemetry Test"], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  execFileSync("git", ["config", "user.email", "telemetry@example.com"], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  fs.writeFileSync(path.join(repoPath, "README.md"), "hello\n", "utf-8");
  execFileSync("git", ["add", "README.md"], {
    cwd: repoPath,
    encoding: "utf-8",
  });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: repoPath,
    encoding: "utf-8",
  });
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
    active_tool_calls: 0,
    result_exists: false,
    derived_status: "starting",
  });

  assert.equal(status, "awaiting_contract");
});

test("deriveTelemetryStatus keeps codex as progressing when session events are fresh", () => {
  const now = Date.parse("2026-03-26T00:10:00.000Z");
  const status = deriveTelemetryStatus(
    {
      terminal_id: "terminal-1",
      worktree_path: "/tmp/project",
      provider: "codex",
      session_attached: true,
      session_attach_confidence: "medium",
      turn_state: "in_turn",
      pty_alive: true,
      descendant_processes: [],
      active_tool_calls: 0,
      result_exists: false,
      last_session_event_at: "2026-03-26T00:09:30.000Z",
      last_meaningful_progress_at: "2026-03-26T00:05:00.000Z",
      derived_status: "starting",
    },
    now,
  );

  assert.equal(status, "progressing");
});

test("deriveTelemetryTaskStatus prefers explicit running/idle signals over PTY noise", () => {
  const runningFromTools = deriveTelemetryTaskStatus({
    terminal_id: "terminal-1",
    worktree_path: "/tmp/project",
    provider: "codex",
    session_attached: true,
    session_attach_confidence: "medium",
    turn_state: "turn_complete",
    pty_alive: true,
    descendant_processes: [],
    active_tool_calls: 1,
    result_exists: false,
    derived_status: "starting",
  });
  assert.deepEqual(runningFromTools, {
    status: "running",
    source: "active_tool_calls",
  });

  const idleFromTurnState = deriveTelemetryTaskStatus({
    terminal_id: "terminal-1",
    worktree_path: "/tmp/project",
    provider: "codex",
    session_attached: true,
    session_attach_confidence: "medium",
    turn_state: "turn_complete",
    pty_alive: true,
    descendant_processes: [],
    active_tool_calls: 0,
    result_exists: false,
    derived_status: "starting",
  });
  assert.deepEqual(idleFromTurnState, { status: "idle", source: "turn_state" });

  const unknownWithoutSignals = deriveTelemetryTaskStatus({
    terminal_id: "terminal-1",
    worktree_path: "/tmp/project",
    provider: "codex",
    session_attached: false,
    session_attach_confidence: "none",
    turn_state: "unknown",
    pty_alive: true,
    descendant_processes: [],
    active_tool_calls: 0,
    result_exists: false,
    derived_status: "starting",
  });
  assert.deepEqual(unknownWithoutSignals, {
    status: "unknown",
    source: "none",
  });
});

test("telemetry service tracks active tool call lifecycle from session events", () => {
  const service = new TelemetryService({ processPollIntervalMs: 0 });
  service.registerTerminal({
    terminalId: "terminal-1",
    worktreePath: "/tmp/project",
    provider: "codex",
  });

  service.recordSessionTelemetry("terminal-1", [
    {
      at: "2026-03-26T00:00:01.000Z",
      event_type: "function_call",
      tool_name: "exec_command",
      call_id: "call-1",
      lifecycle: "start",
      turn_state: "tool_running",
      meaningful_progress: true,
    },
  ]);

  let snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.active_tool_calls, 1);
  assert.equal(snapshot?.foreground_tool, "exec_command");
  assert.equal(snapshot?.last_tool_event_at, "2026-03-26T00:00:01.000Z");
  assert.equal(snapshot?.task_status, "running");
  assert.equal(snapshot?.task_status_source, "active_tool_calls");

  service.recordSessionTelemetry("terminal-1", [
    {
      at: "2026-03-26T00:00:02.000Z",
      event_type: "exec_command_end",
      event_subtype: "completed",
      tool_name: "exec_command",
      call_id: "call-1",
      lifecycle: "end",
      turn_state: "in_turn",
      meaningful_progress: true,
    },
  ]);

  snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.active_tool_calls, 0);
  assert.equal(snapshot?.foreground_tool, undefined);
  assert.equal(snapshot?.last_tool_event_at, "2026-03-26T00:00:02.000Z");
  assert.equal(snapshot?.task_status, "running");
  assert.equal(snapshot?.task_status_source, "turn_state");
});

test("telemetry service preserves completed turn after Stop when stale session events arrive late", () => {
  let nowMs = Date.parse("2026-03-26T00:00:00.000Z");
  const service = new TelemetryService({
    now: () => nowMs,
    processPollIntervalMs: 0,
  });
  service.registerTerminal({
    terminalId: "terminal-1",
    worktreePath: "/tmp/project",
    provider: "codex",
  });
  service.recordPtyCreated({
    terminalId: "terminal-1",
    ptyId: 7,
  });
  service.recordSessionTelemetry("terminal-1", [
    {
      at: "2026-03-26T00:00:01.000Z",
      event_type: "mcp_tool_call_begin",
      tool_name: "playwright-mcp",
      call_id: "call-playwright-1",
      lifecycle: "start",
      turn_state: "tool_running",
      meaningful_progress: true,
    },
  ]);

  nowMs = Date.parse("2026-03-26T00:00:02.000Z");
  service.recordHookEvent("terminal-1", { hook_event_name: "Stop" });

  let snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.turn_state, "turn_complete");
  assert.equal(snapshot?.active_tool_calls, 0);
  assert.equal(snapshot?.foreground_tool, undefined);

  service.recordSessionTelemetry("terminal-1", [
    {
      at: "2026-03-26T00:00:01.500Z",
      event_type: "agent_message",
      turn_state: "in_turn",
      meaningful_progress: true,
    },
  ]);

  snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.turn_state, "turn_complete");
  assert.equal(snapshot?.active_tool_calls, 0);
  assert.equal(snapshot?.foreground_tool, undefined);
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
  service.recordPtyCreated({
    terminalId: "terminal-1",
    ptyId: 7,
    shellPid: 100,
  });
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
  assert.equal(
    snapshot?.last_meaningful_progress_at,
    "2026-03-26T00:00:01.000Z",
  );

  service.recordSessionTelemetry("terminal-1", [
    {
      at: "2026-03-26T00:00:02.000Z",
      event_type: "token_count",
      token_total: 50,
      turn_state: "in_turn",
    },
  ]);
  snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(
    snapshot?.last_meaningful_progress_at,
    "2026-03-26T00:00:01.000Z",
  );

  service.recordProcessSnapshot(
    "terminal-1",
    {
      descendantProcesses: [
        { pid: 200, command: "codex", cli_type: "codex" },
        { pid: 300, command: "npm run build", cli_type: null },
      ],
      foregroundTool: "npm run build",
    },
    "2026-03-26T00:00:03.000Z",
  );

  snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.foreground_tool, "npm run build");
  assert.equal(
    snapshot?.last_meaningful_progress_at,
    "2026-03-26T00:00:03.000Z",
  );

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

  const page = service.listTerminalEvents({
    terminalId: "terminal-1",
    limit: 10,
  });
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

  service.recordPtyCreated({
    terminalId: "terminal-1",
    ptyId: 1,
    shellPid: 100,
  });
  service.recordPtyCreated({
    terminalId: "terminal-1",
    ptyId: 2,
    shellPid: 200,
  });
  service.recordPtyExitByPtyId(1, 0, "2026-03-26T00:00:03.000Z");

  let snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.pty_alive, true);
  assert.notEqual(snapshot?.derived_status, "exited");

  service.recordPtyExitByPtyId(2, 0, "2026-03-26T00:00:04.000Z");
  snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.pty_alive, false);
  assert.equal(snapshot?.derived_status, "exited");
});

test("workflow snapshot reads contract truth from Hydra assignment run", () => {
  const repoPath = createRepoFixture();
  try {
    const workflowId = "workflow-telemetry";
    const assignmentId = "assignment-telemetry";
    const runId = "run-telemetry";
    const workflowDir = path.join(repoPath, ".hydra", "workflows", workflowId);
    const runDir = path.join(workflowDir, "assignments", assignmentId, "runs", runId);
    const artifactsDir = path.join(runDir, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });

    const resultFile = path.join(runDir, "result.json");
    const taskFile = path.join(runDir, "task.md");
    fs.writeFileSync(taskFile, "# Task\n", "utf-8");

    const assignment = {
      schema_version: "hydra/assignment-state/v0.1",
      id: assignmentId,
      workflow_id: workflowId,
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
      role: "reviewer",
      from_assignment_id: null,
      requested_agent_type: "codex",
      status: "in_progress",
      retry_count: 1,
      max_retries: 3,
      timeout_minutes: 15,
      active_run_id: runId,
      runs: [
        {
          id: runId,
          terminal_id: "terminal-1",
          agent_type: "codex",
          prompt: "prompt",
          task_file: taskFile,
          result_file: resultFile,
          artifact_dir: artifactsDir,
          status: "running",
          started_at: "2026-03-26T00:00:00.000Z",
        },
      ],
    };
    fs.writeFileSync(
      path.join(workflowDir, "assignments", assignmentId, "assignment.json"),
      JSON.stringify(assignment, null, 2),
      "utf-8",
    );

    const workflow = {
      schema_version: "hydra/workflow-state/v0.1",
      id: workflowId,
      lead_terminal_id: "terminal-telemetry-test",
      intent_file: "inputs/intent.md",
      repo_path: repoPath,
      worktree_path: repoPath,
      branch: null,
      base_branch: "main",
      own_worktree: false,
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
      status: "active",
      nodes: {
        dev: {
          id: "dev", role: "reviewer", depends_on: [], agent_type: "codex",
          assignment_id: assignmentId, intent_file: "nodes/dev/intent.md",
        },
      },
      node_statuses: { dev: "dispatched" },
      assignment_ids: [assignmentId],
      default_timeout_minutes: 15,
      default_max_retries: 3,
      default_agent_type: "codex",
      auto_approve: false,
    };
    fs.writeFileSync(
      path.join(workflowDir, "workflow.json"),
      JSON.stringify(workflow, null, 2),
      "utf-8",
    );

    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        schema_version: "hydra/result/v0.1",
        workflow_id: workflowId,
        assignment_id: assignmentId,
        run_id: runId,
        outcome: "completed",
        summary: "done",
        outputs: [],
        evidence: ["test"],
      }, null, 2),
      "utf-8",
    );

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
    service.recordSessionTelemetry("terminal-1", [
      {
        at: "2026-03-26T00:00:05.000Z",
        event_type: "task_complete",
        turn_state: "turn_complete",
        meaningful_progress: true,
      },
    ]);

    const workflowSnapshot = service.getWorkflowSnapshot(repoPath, workflowId);
    assert.ok(workflowSnapshot);
    assert.equal(workflowSnapshot?.contract.result_exists, true);
    assert.equal(workflowSnapshot?.contract.result_valid, true);
    assert.equal(workflowSnapshot?.retry_budget.remaining, 2);
    assert.equal(workflowSnapshot?.terminal?.result_exists, true);
    service.dispose();
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("recordHookEvent SessionStart uses registered provider instead of hardcoded claude", () => {
  const service = new TelemetryService({ processPollIntervalMs: 0 });
  service.registerTerminal({
    terminalId: "t-codex",
    worktreePath: "/repo",
    provider: "codex",
  });

  service.recordHookEvent("t-codex", {
    hook_event_name: "SessionStart",
    session_id: "sess-codex-1",
    transcript_path: "/tmp/codex-session.jsonl",
  });

  const snap = service.getTerminalSnapshot("t-codex")!;
  assert.equal(snap.provider, "codex");
  assert.equal(snap.session_id, "sess-codex-1");
  service.dispose();
});

test("deriveTelemetryStatus returns progressing when active_tool_calls > 0", () => {
  const status = deriveTelemetryStatus(
    {
      terminal_id: "terminal-1",
      worktree_path: "/tmp/project",
      provider: "codex",
      session_attached: true,
      session_attach_confidence: "medium",
      turn_state: "in_turn",
      pty_alive: true,
      descendant_processes: [],
      active_tool_calls: 2,
      result_exists: false,
      last_output_at: "2026-03-26T00:00:01.000Z",
      last_meaningful_progress_at: "2026-03-26T00:00:01.000Z",
      derived_status: "starting",
    },
    Date.parse("2026-03-26T01:00:00.000Z"),
  ); // 1 hour later — well past all thresholds

  assert.equal(status, "progressing");
});

test("deriveTelemetryStatus returns stall_candidate for Codex in_turn when session events are stale", () => {
  const now = Date.parse("2026-03-26T00:10:00.000Z");
  const status = deriveTelemetryStatus(
    {
      terminal_id: "terminal-1",
      worktree_path: "/tmp/project",
      provider: "codex",
      session_attached: true,
      session_attach_confidence: "medium",
      turn_state: "in_turn",
      pty_alive: true,
      descendant_processes: [],
      active_tool_calls: 0,
      result_exists: false,
      // session event 4 min ago (stale beyond 90s heartbeat)
      last_session_event_at: "2026-03-26T00:06:00.000Z",
      // meaningful progress 5 min ago (stale beyond 180s Codex threshold)
      last_meaningful_progress_at: "2026-03-26T00:05:00.000Z",
      last_output_at: "2026-03-26T00:05:00.000Z",
      derived_status: "starting",
    },
    now,
  );

  // in_turn + session_attached with stale events should NOT be progressing —
  // the CLI may have exited without a Stop hook.
  assert.equal(status, "stall_candidate");
});

test("deriveTelemetryStatus returns progressing for Codex in_turn with recent session events", () => {
  const now = Date.parse("2026-03-26T00:10:00.000Z");
  const status = deriveTelemetryStatus(
    {
      terminal_id: "terminal-1",
      worktree_path: "/tmp/project",
      provider: "codex",
      session_attached: true,
      session_attach_confidence: "medium",
      turn_state: "in_turn",
      pty_alive: true,
      descendant_processes: [],
      active_tool_calls: 0,
      result_exists: false,
      // session event 30s ago (within 90s heartbeat)
      last_session_event_at: "2026-03-26T00:09:30.000Z",
      last_meaningful_progress_at: "2026-03-26T00:09:30.000Z",
      last_output_at: "2026-03-26T00:09:30.000Z",
      derived_status: "starting",
    },
    now,
  );

  assert.equal(status, "progressing");
});
