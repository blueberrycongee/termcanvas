import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  TelemetryService,
  deriveTelemetryStatus,
  deriveTelemetryTaskStatus,
} from "../electron/telemetry-service.ts";
import {
  CLAUDE_PRE_TOOL_USE_FALLBACK_MS,
  CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS,
} from "../shared/lifecycleThresholds.ts";
import { WORKBENCH_STATE_SCHEMA_VERSION } from "../hydra/src/workflow-store.ts";

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

function writeSessionJsonl(
  filePath: string,
  prompt: string,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      JSON.stringify({
        timestamp: "2026-03-26T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: path.basename(filePath, ".jsonl"),
          timestamp: "2026-03-26T00:00:00.000Z",
          cwd: "/tmp/project",
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-26T00:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
          ],
        },
      }),
    ].join("\n"),
    "utf-8",
  );
}

function writeWuuSessionJsonl(
  filePath: string,
  prompt: string,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      JSON.stringify({
        role: "user",
        content: prompt,
        at: "2026-03-26T00:00:01.000Z",
      }),
      JSON.stringify({
        role: "assistant",
        content: "收到",
        at: "2026-03-26T00:00:02.000Z",
      }),
    ].join("\n"),
    "utf-8",
  );
}

function writeOpenCodeSessionDb(
  filePath: string,
  input: {
    sessionId: string;
    prompt: string;
    assistantFinish?: "stop" | "tool-calls";
  },
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "msg_user",
      input.sessionId,
      1775339237000,
      1775339237000,
      JSON.stringify({ role: "user" }),
    );
    db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "prt_user",
      "msg_user",
      input.sessionId,
      1775339237001,
      1775339237001,
      JSON.stringify({ type: "text", text: input.prompt }),
    );
    db.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      "msg_assistant",
      input.sessionId,
      1775339238000,
      1775339239000,
      JSON.stringify({
        role: "assistant",
        finish: input.assistantFinish ?? "stop",
      }),
    );
    db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "prt_reasoning",
      "msg_assistant",
      input.sessionId,
      1775339238001,
      1775339238001,
      JSON.stringify({ type: "reasoning", text: "thinking" }),
    );
    db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "prt_text",
      "msg_assistant",
      input.sessionId,
      1775339238500,
      1775339238500,
      JSON.stringify({ type: "text", text: "done" }),
    );
    db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "prt_finish",
      "msg_assistant",
      input.sessionId,
      1775339239000,
      1775339239000,
      JSON.stringify({
        type: "step-finish",
        reason: input.assistantFinish ?? "stop",
      }),
    );
  } finally {
    db.close();
  }
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

test("deriveTelemetryStatus keeps completed turns idle instead of stalling", () => {
  const now = Date.parse("2026-03-26T00:20:00.000Z");
  const status = deriveTelemetryStatus(
    {
      terminal_id: "terminal-1",
      worktree_path: "/tmp/project",
      provider: "claude",
      session_attached: true,
      session_attach_confidence: "medium",
      turn_state: "turn_complete",
      pty_alive: true,
      descendant_processes: [],
      active_tool_calls: 0,
      result_exists: false,
      last_output_at: "2026-03-26T00:00:05.000Z",
      last_input_at: "2026-03-26T00:00:01.000Z",
      last_session_event_at: "2026-03-26T00:00:05.000Z",
      last_meaningful_progress_at: "2026-03-26T00:00:05.000Z",
      derived_status: "starting",
    },
    now,
  );

  assert.equal(status, "idle");
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

test("deriveTelemetryStatus treats opencode as an agent provider", () => {
  const now = Date.parse("2026-03-26T00:10:00.000Z");
  const status = deriveTelemetryStatus(
    {
      terminal_id: "terminal-1",
      worktree_path: "/tmp/project",
      provider: "opencode",
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
  // Agent terminal in "in_turn" with no active tool call: descendants
  // are infrastructure noise (MCP servers, build subprocesses spawned
  // by the agent's previous step that haven't died yet), not the tool
  // the agent is currently running. Keep foreground_tool unset and do
  // NOT bump last_meaningful_progress_at — the session events above
  // already set it to 01.000Z, and ps churn from idle daemons is not
  // progress.
  assert.equal(snapshot?.foreground_tool, undefined);
  assert.equal(
    snapshot?.last_meaningful_progress_at,
    "2026-03-26T00:00:01.000Z",
  );

  nowMs = Date.parse("2026-03-26T00:00:04.000Z");
  snapshot = service.getTerminalSnapshot("terminal-1");
  // Still progressing — via the session-event heartbeat check, not ps.
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

test("telemetry service preserves exited snapshots after session detach", () => {
  const service = new TelemetryService({ processPollIntervalMs: 0 });
  service.registerTerminal({
    terminalId: "terminal-1",
    worktreePath: "/tmp/project",
    provider: "codex",
  });

  service.attachSessionSource({
    terminalId: "terminal-1",
    provider: "codex",
    confidence: "medium",
    sessionId: "session-1",
    sessionFile: "/tmp/session-1.jsonl",
  });
  service.recordPtyCreated({
    terminalId: "terminal-1",
    ptyId: 7,
    shellPid: 700,
  });

  service.recordPtyExit("terminal-1", 0, "2026-03-26T00:00:04.000Z");
  service.detachSessionSource("terminal-1");

  const snapshot = service.getTerminalSnapshot("terminal-1");
  assert.equal(snapshot?.pty_alive, false);
  assert.equal(snapshot?.exit_code, 0);
  assert.equal(snapshot?.derived_status, "exited");
});

test("workflow snapshot reads contract truth from Hydra assignment run", () => {
  const repoPath = createRepoFixture();
  try {
    const workflowId = "workflow-telemetry";
    const assignmentId = "assignment-telemetry";
    const runId = "run-telemetry";
    const workflowDir = path.join(repoPath, ".hydra", "workbenches", workflowId);
    const dispatchDir = path.join(workflowDir, "dispatches", assignmentId);
    const runDir = path.join(dispatchDir, "runs", runId);
    const artifactsDir = path.join(runDir, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });

    const resultFile = path.join(runDir, "result.json");
    const reportFile = path.join(runDir, "report.md");
    const taskFile = path.join(runDir, "task.md");
    fs.writeFileSync(taskFile, "# Task\n", "utf-8");
    fs.writeFileSync(reportFile, "# Report\n", "utf-8");

    const assignment = {
      schema_version: "hydra/assignment-state/v0.1",
      id: assignmentId,
      workbench_id: workflowId,
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
      path.join(dispatchDir, "assignment.json"),
      JSON.stringify(assignment, null, 2),
      "utf-8",
    );

    const workflow = {
      schema_version: WORKBENCH_STATE_SCHEMA_VERSION,
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
      dispatches: {
        [assignmentId]: {
          id: assignmentId,
          role: "reviewer",
          agent_type: "codex",
          status: "dispatched",
          intent_file: "dispatches/assignment-telemetry/intent.md",
        },
      },
      default_timeout_minutes: 15,
      default_max_retries: 3,
      auto_approve: false,
    };
    fs.writeFileSync(
      path.join(workflowDir, "workbench.json"),
      JSON.stringify(workflow, null, 2),
      "utf-8",
    );

    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        schema_version: "hydra/result/v0.1",
        workbench_id: workflowId,
        assignment_id: assignmentId,
        run_id: runId,
        outcome: "completed",
        report_file: reportFile,
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

test("attachSessionSource refreshes first_user_prompt when a terminal reattaches to a different session", () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-telemetry-session-"),
  );
  const oldSessionFile = path.join(tmpDir, "old-session.jsonl");
  const newSessionFile = path.join(tmpDir, "new-session.jsonl");
  writeSessionJsonl(oldSessionFile, "你是谁");
  writeSessionJsonl(
    newSessionFile,
    "我感觉现在的 termcanvas 右侧的那个 session 显示我们发送第一句话的那个 bug 还是存在",
  );

  const service = new TelemetryService({ processPollIntervalMs: 0 });
  try {
    service.registerTerminal({
      terminalId: "terminal-1",
      worktreePath: "/tmp/project",
      provider: "codex",
    });

    service.attachSessionSource({
      terminalId: "terminal-1",
      provider: "codex",
      sessionId: "old-session",
      confidence: "medium",
      sessionFile: oldSessionFile,
    });
    assert.equal(
      service.getTerminalSnapshot("terminal-1")?.first_user_prompt,
      "你是谁",
    );

    service.attachSessionSource({
      terminalId: "terminal-1",
      provider: "codex",
      sessionId: "new-session",
      confidence: "strong",
      sessionFile: newSessionFile,
    });

    assert.equal(
      service.getTerminalSnapshot("terminal-1")?.first_user_prompt,
      "我感觉现在的 termcanvas 右侧的那个 session 显示我们发送第一句话的那个 bug 还是存在",
    );
  } finally {
    service.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("attachSessionSource extracts first_user_prompt from wuu session files", () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-telemetry-wuu-session-"),
  );
  const sessionFile = path.join(tmpDir, "wuu-session.jsonl");
  writeWuuSessionJsonl(
    sessionFile,
    "右侧的 session 我想支持一下 现在没支持好",
  );

  const service = new TelemetryService({ processPollIntervalMs: 0 });
  try {
    service.registerTerminal({
      terminalId: "terminal-1",
      worktreePath: "/tmp/project",
      provider: "wuu",
    });

    service.attachSessionSource({
      terminalId: "terminal-1",
      provider: "wuu",
      sessionId: "wuu-session",
      confidence: "medium",
      sessionFile,
    });

    assert.equal(
      service.getTerminalSnapshot("terminal-1")?.first_user_prompt,
      "右侧的 session 我想支持一下 现在没支持好",
    );
  } finally {
    service.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("attachSessionSource reads opencode first prompt and lifecycle from db", () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-telemetry-opencode-session-"),
  );
  const sessionFile = path.join(tmpDir, "opencode.db");
  writeOpenCodeSessionDb(sessionFile, {
    sessionId: "ses_123",
    prompt: "左侧 OpenCode 终端状态一直是灰色",
  });

  const service = new TelemetryService({
    processPollIntervalMs: 0,
  });
  try {
    service.registerTerminal({
      terminalId: "terminal-1",
      worktreePath: "/tmp/project",
      provider: "opencode",
    });

    service.attachSessionSource({
      terminalId: "terminal-1",
      provider: "opencode",
      sessionId: "ses_123",
      confidence: "medium",
      sessionFile,
    });

    const snapshot = service.getTerminalSnapshot("terminal-1");
    assert.equal(
      snapshot?.first_user_prompt,
      "左侧 OpenCode 终端状态一直是灰色",
    );
    assert.equal(snapshot?.session_attached, true);
    assert.equal(snapshot?.turn_state, "turn_complete");
    assert.equal(snapshot?.task_status, "idle");
    assert.equal(snapshot?.last_session_event_kind, "turn_complete");
  } finally {
    service.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("attachSessionSource keeps opencode tool-call steps active and pushes first prompt", () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-telemetry-opencode-active-"),
  );
  const sessionFile = path.join(tmpDir, "opencode.db");
  writeOpenCodeSessionDb(sessionFile, {
    sessionId: "ses_active",
    prompt: "检查 OpenCode 左侧标题和状态",
    assistantFinish: "tool-calls",
  });

  const pushed: string[] = [];
  const service = new TelemetryService({
    processPollIntervalMs: 0,
    onSnapshotChanged: (_terminalId, snapshot) => {
      if (snapshot.first_user_prompt) {
        pushed.push(snapshot.first_user_prompt);
      }
    },
  });
  try {
    service.registerTerminal({
      terminalId: "terminal-1",
      worktreePath: "/tmp/project",
      provider: "opencode",
    });

    service.attachSessionSource({
      terminalId: "terminal-1",
      provider: "opencode",
      sessionId: "ses_active",
      confidence: "medium",
      sessionFile,
    });

    const snapshot = service.getTerminalSnapshot("terminal-1");
    assert.equal(snapshot?.first_user_prompt, "检查 OpenCode 左侧标题和状态");
    assert.equal(snapshot?.turn_state, "in_turn");
    assert.equal(snapshot?.task_status, "running");
    assert.equal(snapshot?.task_status_source, "turn_state");
    assert.equal(snapshot?.last_session_event_kind, "assistant_step");
    assert.ok(
      pushed.includes("检查 OpenCode 左侧标题和状态"),
      "first prompt should be pushed to renderer even when status did not change",
    );
  } finally {
    service.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("detachSessionSource clears stale session identity and first_user_prompt", () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "termcanvas-telemetry-detach-session-"),
  );
  const sessionFile = path.join(tmpDir, "session.jsonl");
  writeSessionJsonl(
    sessionFile,
    "旧会话的第一句话不应该在 detach 之后继续挂在左侧",
  );

  const service = new TelemetryService({ processPollIntervalMs: 0 });
  try {
    service.registerTerminal({
      terminalId: "terminal-1",
      worktreePath: "/tmp/project",
      provider: "codex",
    });

    service.attachSessionSource({
      terminalId: "terminal-1",
      provider: "codex",
      sessionId: "session-1",
      confidence: "strong",
      sessionFile,
    });

    service.detachSessionSource("terminal-1");

    const snapshot = service.getTerminalSnapshot("terminal-1");
    assert.equal(snapshot?.session_attached, false);
    assert.equal(snapshot?.session_attach_confidence, "none");
    assert.equal(snapshot?.session_id, undefined);
    assert.equal(snapshot?.session_file, undefined);
    assert.equal(snapshot?.first_user_prompt, undefined);
    assert.equal(snapshot?.turn_state, "unknown");
    assert.equal(snapshot?.foreground_tool, undefined);
    assert.equal(snapshot?.active_tool_calls, 0);
  } finally {
    service.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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

test("Claude Notification hook flips turn_state to awaiting_input immediately", () => {
  mock.timers.enable(["setTimeout"]);
  try {
    let nowMs = Date.parse("2026-04-16T00:00:00.000Z");
    const service = new TelemetryService({
      now: () => nowMs,
      processPollIntervalMs: 0,
    });
    service.registerTerminal({
      terminalId: "claude-1",
      worktreePath: "/repo",
      provider: "claude",
    });
    service.recordHookEvent("claude-1", {
      hook_event_name: "SessionStart",
      session_id: "sess-1",
    });

    // Tool starts — turn_state should now be tool_running, NOT awaiting_input.
    service.recordHookEvent("claude-1", {
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      tool_name: "Bash",
    });
    assert.equal(
      service.getTerminalSnapshot("claude-1")?.turn_state,
      "tool_running",
    );

    // User approval notification arrives — flip immediately, no need to
    // wait out the Claude fallback window.
    nowMs += 200;
    service.recordHookEvent("claude-1", {
      hook_event_name: "Notification",
      session_id: "sess-1",
      notification_type: "permission_prompt",
      message: "Claude needs your permission to use Bash",
    });
    assert.equal(
      service.getTerminalSnapshot("claude-1")?.turn_state,
      "awaiting_input",
    );

    // The long fallback timer shouldn't fire after PostToolUse clears
    // pendingPreToolUse.
    nowMs += 500;
    service.recordHookEvent("claude-1", {
      hook_event_name: "PostToolUse",
      session_id: "sess-1",
      tool_name: "Bash",
    });
    mock.timers.tick(CLAUDE_PRE_TOOL_USE_FALLBACK_MS + 1_000);
    assert.notEqual(
      service.getTerminalSnapshot("claude-1")?.turn_state,
      "awaiting_input",
    );

    service.dispose();
  } finally {
    mock.timers.reset();
  }
});

test(
  "Claude idle_prompt notification does not resurrect a completed turn",
  () => {
    let nowMs = Date.parse("2026-04-20T02:00:00.000Z");
    const service = new TelemetryService({
      now: () => nowMs,
      processPollIntervalMs: 0,
    });
    service.registerTerminal({
      terminalId: "claude-idle-prompt",
      worktreePath: "/repo",
      provider: "claude",
    });
    service.recordHookEvent("claude-idle-prompt", {
      hook_event_name: "SessionStart",
      session_id: "sess-idle",
    });
    service.recordHookEvent("claude-idle-prompt", {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-idle",
    });
    service.recordHookEvent("claude-idle-prompt", {
      hook_event_name: "Stop",
      session_id: "sess-idle",
    });

    assert.equal(
      service.getTerminalSnapshot("claude-idle-prompt")?.turn_state,
      "turn_complete",
    );

    nowMs += 60_000;
    service.recordHookEvent("claude-idle-prompt", {
      hook_event_name: "Notification",
      session_id: "sess-idle",
      notification_type: "idle_prompt",
      message: "Claude has been idle waiting for your input",
    });

    const snapshot = service.getTerminalSnapshot("claude-idle-prompt");
    assert.equal(snapshot?.turn_state, "turn_complete");

    service.dispose();
  },
);

test(
  "Claude auth-success notification does not mark awaiting_input",
  () => {
    const service = new TelemetryService({ processPollIntervalMs: 0 });
    service.registerTerminal({
      terminalId: "claude-auth-success",
      worktreePath: "/repo",
      provider: "claude",
    });
    service.recordHookEvent("claude-auth-success", {
      hook_event_name: "SessionStart",
      session_id: "sess-auth",
    });
    service.recordHookEvent("claude-auth-success", {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-auth",
    });
    service.recordHookEvent("claude-auth-success", {
      hook_event_name: "Stop",
      session_id: "sess-auth",
    });
    service.recordHookEvent("claude-auth-success", {
      hook_event_name: "Notification",
      session_id: "sess-auth",
      notification_type: "auth_success",
      message: "Task completed successfully",
    });

    const snapshot = service.getTerminalSnapshot("claude-auth-success");
    assert.equal(snapshot?.turn_state, "turn_complete");

    service.dispose();
  },
);

test(
  "Claude PreToolUse without Notification only falls back after the long window",
  () => {
    mock.timers.enable(["setTimeout"]);
    try {
      let nowMs = Date.parse("2026-04-16T00:00:00.000Z");
      const service = new TelemetryService({
        now: () => nowMs,
        processPollIntervalMs: 0,
      });
      service.registerTerminal({
        terminalId: "claude-2",
        worktreePath: "/repo",
        provider: "claude",
      });
      service.recordHookEvent("claude-2", {
        hook_event_name: "SessionStart",
        session_id: "sess-2",
      });
      service.recordHookEvent("claude-2", {
        hook_event_name: "PreToolUse",
        session_id: "sess-2",
        tool_name: "Bash",
      });

      // Halfway through the Claude fallback — must NOT be flagged yet.
      // This is the key regression guard against the old 5 s behaviour
      // that mis-flagged ordinary long-running tools.
      mock.timers.tick(CLAUDE_PRE_TOOL_USE_FALLBACK_MS / 2);
      nowMs += CLAUDE_PRE_TOOL_USE_FALLBACK_MS / 2;
      assert.equal(
        service.getTerminalSnapshot("claude-2")?.turn_state,
        "tool_running",
      );

      // Once the full window elapses, the safety-net flips us.
      mock.timers.tick(CLAUDE_PRE_TOOL_USE_FALLBACK_MS / 2 + 1);
      nowMs += CLAUDE_PRE_TOOL_USE_FALLBACK_MS / 2 + 1;
      assert.equal(
        service.getTerminalSnapshot("claude-2")?.turn_state,
        "awaiting_input",
      );

      service.dispose();
    } finally {
      mock.timers.reset();
    }
  },
);

test(
  "Claude tool_result clears awaiting_input when PostToolUse never arrives",
  () => {
    mock.timers.enable(["setTimeout"]);
    try {
      let nowMs = Date.parse("2026-04-20T00:00:00.000Z");
      const service = new TelemetryService({
        now: () => nowMs,
        processPollIntervalMs: 0,
      });
      service.registerTerminal({
        terminalId: "claude-3",
        worktreePath: "/repo",
        provider: "claude",
      });
      service.recordHookEvent("claude-3", {
        hook_event_name: "SessionStart",
        session_id: "sess-3",
      });
      service.recordHookEvent("claude-3", {
        hook_event_name: "PreToolUse",
        session_id: "sess-3",
        tool_name: "Bash",
      });

      mock.timers.tick(CLAUDE_PRE_TOOL_USE_FALLBACK_MS + 1);
      nowMs += CLAUDE_PRE_TOOL_USE_FALLBACK_MS + 1;
      assert.equal(
        service.getTerminalSnapshot("claude-3")?.turn_state,
        "awaiting_input",
      );
      assert.equal(
        service.getTerminalSnapshot("claude-3")?.foreground_tool,
        "Bash",
      );

      service.recordSessionTelemetry("claude-3", [
        {
          at: new Date(nowMs + 500).toISOString(),
          event_type: "tool_result",
          role: "user",
          turn_state: "in_turn",
          meaningful_progress: true,
        },
      ]);

      const snapshot = service.getTerminalSnapshot("claude-3");
      assert.equal(snapshot?.turn_state, "in_turn");
      assert.equal(snapshot?.pending_tool_use_at, undefined);
      assert.equal(snapshot?.foreground_tool, undefined);

      service.dispose();
    } finally {
      mock.timers.reset();
    }
  },
);

test(
  "Codex PreToolUse uses the codex-specific silence window for awaiting_input",
  () => {
    mock.timers.enable(["setTimeout"]);
    try {
      let nowMs = Date.parse("2026-04-16T00:00:00.000Z");
      const service = new TelemetryService({
        now: () => nowMs,
        processPollIntervalMs: 0,
      });
      service.registerTerminal({
        terminalId: "codex-1",
        worktreePath: "/repo",
        provider: "codex",
      });
      service.recordHookEvent("codex-1", {
        hook_event_name: "SessionStart",
        session_id: "codex-sess",
      });
      service.recordHookEvent("codex-1", {
        hook_event_name: "PreToolUse",
        session_id: "codex-sess",
        tool_name: "Bash",
      });

      // Past the 20 s Codex window but well below Claude's 30 s — the
      // provider-specific constant is what we verify here.
      mock.timers.tick(CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS + 1);
      nowMs += CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS + 1;
      assert.equal(
        service.getTerminalSnapshot("codex-1")?.turn_state,
        "awaiting_input",
      );

      service.dispose();
    } finally {
      mock.timers.reset();
    }
  },
);

test(
  "Session turn_complete from JSONL clears awaiting_input when Stop hook never arrives",
  () => {
    // Regression for the "session panel stuck red after Codex reply ends"
    // bug. Scenario: PreToolUse fires → Codex-specific 20 s fallback
    // timer flips turn_state to awaiting_input → Codex keeps reasoning
    // and the turn wraps, but the Stop hook is absent (user declined
    // exec approval; Codex moved on without emitting PostToolUse, then
    // the Stop hook socket was racy / the hook pipeline dropped it).
    // The only signal the turn is over is the session JSONL writing
    // `turn_complete`. Previously that update was blocked by
    // `preserveAwaitingInput`, leaving the tile red for up to 5 minutes
    // until the stale-pending-hook safety net kicked in.
    mock.timers.enable(["setTimeout"]);
    try {
      let nowMs = Date.parse("2026-04-17T00:00:00.000Z");
      const service = new TelemetryService({
        now: () => nowMs,
        processPollIntervalMs: 0,
      });
      service.registerTerminal({
        terminalId: "codex-2",
        worktreePath: "/repo",
        provider: "codex",
      });
      service.recordHookEvent("codex-2", {
        hook_event_name: "SessionStart",
        session_id: "codex-sess-2",
      });
      service.recordHookEvent("codex-2", {
        hook_event_name: "PreToolUse",
        session_id: "codex-sess-2",
        tool_name: "Bash",
      });

      // Let the 20 s fallback fire so we're parked at awaiting_input
      // with pendingPreToolUse still true.
      mock.timers.tick(CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS + 1);
      nowMs += CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS + 1;
      assert.equal(
        service.getTerminalSnapshot("codex-2")?.turn_state,
        "awaiting_input",
      );
      assert.equal(service.getTerminalSnapshot("codex-2")?.pending_tool_use_at
        ? true
        : false, true);

      // No Stop hook. Session JSONL instead reports the turn ended.
      // This should win over the stale pending-hook state.
      nowMs += 500;
      service.recordSessionTelemetry("codex-2", [
        {
          at: new Date(nowMs).toISOString(),
          event_type: "agent_message",
          turn_state: "turn_complete",
          meaningful_progress: true,
        },
      ]);

      const snap = service.getTerminalSnapshot("codex-2");
      assert.equal(snap?.turn_state, "turn_complete");
      // Side effect: pending hook state is reconciled so subsequent
      // renders don't mis-attribute the tile to any tool.
      assert.equal(snap?.pending_tool_use_at, undefined);

      service.dispose();
    } finally {
      mock.timers.reset();
    }
  },
);

test(
  "SessionEnd releases awaiting_input if we were parked there",
  () => {
    // Secondary path for the stuck-red-badge bug: a Codex / Claude
    // session can end without emitting Stop (SIGINT, process crash,
    // user closes CLI). Before this fix, SessionEnd cleared the
    // pending hook bookkeeping but left turn_state at awaiting_input
    // — the session panel kept showing red for a dead terminal.
    mock.timers.enable(["setTimeout"]);
    try {
      let nowMs = Date.parse("2026-04-17T01:00:00.000Z");
      const service = new TelemetryService({
        now: () => nowMs,
        processPollIntervalMs: 0,
      });
      service.registerTerminal({
        terminalId: "codex-3",
        worktreePath: "/repo",
        provider: "codex",
      });
      service.recordHookEvent("codex-3", {
        hook_event_name: "SessionStart",
        session_id: "codex-sess-3",
      });
      service.recordHookEvent("codex-3", {
        hook_event_name: "PreToolUse",
        session_id: "codex-sess-3",
        tool_name: "Bash",
      });
      mock.timers.tick(CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS + 1);
      nowMs += CODEX_PRE_TOOL_USE_AWAITING_INPUT_MS + 1;
      assert.equal(
        service.getTerminalSnapshot("codex-3")?.turn_state,
        "awaiting_input",
      );

      service.recordHookEvent("codex-3", { hook_event_name: "SessionEnd" });

      const snap = service.getTerminalSnapshot("codex-3");
      assert.equal(snap?.turn_state, "turn_aborted");
      assert.equal(snap?.pending_tool_use_at, undefined);

      service.dispose();
    } finally {
      mock.timers.reset();
    }
  },
);

test(
  "Codex with idle MCP daemon descendants does not get foreground_tool polluted",
  () => {
    // Regression: opening a Codex terminal configured with playwright-mcp
    // used to show a persistent "running playwright mcp" yellow state on
    // the session panel. Cause: Codex spawns the MCP server as a
    // subprocess (see thirdparty/codex .../rmcp_client.rs); the shell's
    // descendants include that daemon forever, and we blindly wrote its
    // command into foreground_tool. Session panel then read
    // `turn_state=in_turn && foreground_tool!=null` → "running".
    const service = new TelemetryService({ processPollIntervalMs: 0 });
    service.registerTerminal({
      terminalId: "codex-mcp",
      worktreePath: "/repo",
      provider: "codex",
    });
    service.recordSessionAttached({
      terminalId: "codex-mcp",
      provider: "codex",
      sessionId: "sess",
      confidence: "medium",
    });
    // Mimic the "Codex just started, hasn't run a tool yet" steady state.
    service.recordSessionTelemetry("codex-mcp", [
      {
        at: "2026-04-16T00:00:01.000Z",
        event_type: "turn_started",
        turn_state: "in_turn",
        meaningful_progress: true,
      },
    ]);

    service.recordProcessSnapshot(
      "codex-mcp",
      {
        descendantProcesses: [
          { pid: 10, command: "codex", cli_type: "codex" },
          // Daemon: playwright-mcp server. Long-lived, user never typed a thing.
          { pid: 20, command: "npx @playwright/mcp-server", cli_type: null },
        ],
        foregroundTool: "npx @playwright/mcp-server",
      },
      "2026-04-16T00:00:02.000Z",
    );

    const snap = service.getTerminalSnapshot("codex-mcp");
    assert.equal(snap?.foreground_tool, undefined);
    service.dispose();
  },
);

test(
  "Codex with active tool call DOES pick up descendant foreground_tool",
  () => {
    // Positive case: when the session *does* say a tool is running, the
    // ps-derived foreground_tool remains useful (covers hook-less Codex
    // flows where the session is the only signal we have).
    const service = new TelemetryService({ processPollIntervalMs: 0 });
    service.registerTerminal({
      terminalId: "codex-tool",
      worktreePath: "/repo",
      provider: "codex",
    });
    service.recordSessionAttached({
      terminalId: "codex-tool",
      provider: "codex",
      sessionId: "sess",
      confidence: "medium",
    });
    service.recordSessionTelemetry("codex-tool", [
      {
        at: "2026-04-16T00:00:01.000Z",
        event_type: "exec_command_begin",
        tool_name: "exec_command",
        call_id: "call-1",
        lifecycle: "start",
        turn_state: "tool_running",
        meaningful_progress: true,
      },
    ]);

    service.recordProcessSnapshot(
      "codex-tool",
      {
        descendantProcesses: [
          { pid: 10, command: "codex", cli_type: "codex" },
          { pid: 11, command: "npm run build", cli_type: null },
        ],
        foregroundTool: "npm run build",
      },
      "2026-04-16T00:00:02.000Z",
    );

    const snap = service.getTerminalSnapshot("codex-tool");
    assert.equal(snap?.foreground_tool, "npm run build");
    service.dispose();
  },
);

test(
  "shell terminal keeps the descendant foreground_tool verbatim",
  () => {
    // Guard against over-correction: plain shell terminals have no
    // hooks or session events, so the ps-derived tool name is the ONLY
    // signal available and must keep flowing through.
    const service = new TelemetryService({ processPollIntervalMs: 0 });
    service.registerTerminal({
      terminalId: "shell-1",
      worktreePath: "/repo",
      // no provider → plain shell
    });

    service.recordProcessSnapshot(
      "shell-1",
      {
        descendantProcesses: [
          { pid: 10, command: "bash", cli_type: null },
          { pid: 11, command: "vim README.md", cli_type: null },
        ],
        foregroundTool: "vim README.md",
      },
      "2026-04-16T00:00:01.000Z",
    );

    const snap = service.getTerminalSnapshot("shell-1");
    assert.equal(snap?.foreground_tool, "vim README.md");
    service.dispose();
  },
);

test(
  "fresh Codex with MCP daemons and no user input does not show as progressing",
  () => {
    // Regression: even after the foreground_tool fix, opening a fresh
    // Codex terminal with playwright-mcp configured kept the session
    // panel green-"thinking" persistently. Cause: ps churn (MCP server
    // spawning its own child processes: Chromium, service workers…) was
    // bumping last_meaningful_progress_at every poll, which kept
    // derived_status = "progressing" via the stall-threshold window.
    // Nothing actually stopped "progressing" because the agent had
    // never even received a prompt.
    let nowMs = Date.parse("2026-04-16T00:00:00.000Z");
    const service = new TelemetryService({
      now: () => nowMs,
      processPollIntervalMs: 0,
    });
    service.registerTerminal({
      terminalId: "codex-fresh",
      worktreePath: "/repo",
      provider: "codex",
    });
    service.recordPtyCreated({
      terminalId: "codex-fresh",
      ptyId: 42,
      shellPid: 100,
    });
    // Session attaches once hooks fire SessionStart, but the user has
    // not typed a prompt, so no session events have landed yet.
    service.recordSessionAttached({
      terminalId: "codex-fresh",
      provider: "codex",
      sessionId: "sess",
      confidence: "strong",
    });
    // Banner output from Codex boot — sets last_output_at. This used
    // to be enough to trip stall_candidate on its own.
    service.recordPtyOutput(
      "codex-fresh",
      "Codex CLI v0.52 — type to begin\n",
      "2026-04-16T00:00:01.000Z",
    );
    // Repeated ps snapshots as MCP server boots and spawns its children.
    for (let i = 0; i < 5; i += 1) {
      const at = `2026-04-16T00:00:0${2 + i}.000Z`;
      nowMs = Date.parse(at);
      service.recordProcessSnapshot(
        "codex-fresh",
        {
          descendantProcesses: [
            { pid: 100, command: "codex", cli_type: "codex" },
            {
              pid: 200 + i,
              command: "npx @playwright/mcp-server",
              cli_type: null,
            },
            // Mock one of Playwright's Chromium descendants appearing
            // after the first few polls — the kind of churn that used
            // to masquerade as meaningful progress.
            ...(i >= 2
              ? [
                  {
                    pid: 300 + i,
                    command: "/usr/bin/chromium --headless",
                    cli_type: null,
                  },
                ]
              : []),
          ],
          foregroundTool:
            i >= 2
              ? "/usr/bin/chromium --headless"
              : "npx @playwright/mcp-server",
        },
        at,
      );
    }

    const snap = service.getTerminalSnapshot("codex-fresh");
    // The descendant tree never got written into foreground_tool …
    assert.equal(snap?.foreground_tool, undefined);
    // … and ps-only churn did not bump the progress clock.
    assert.equal(snap?.last_meaningful_progress_at, undefined);
    // Which means derived_status stays in the neutral "starting" state,
    // and the session panel renders it as idle (gray) rather than the
    // previous persistent green-"thinking" or yellow-"running mcp".
    assert.equal(snap?.derived_status, "starting");
    service.dispose();
  },
);

test(
  "provider upgrade from unknown to codex clears ps-derived state captured during the unknown window",
  () => {
    // Regression observed via DevTools telemetry dump: opening a fresh
    // Codex terminal went through a brief window where
    // `snapshot.provider === "unknown"` before CLI detection upgraded
    // it. During that window the ps gate treated the terminal as a
    // plain shell and bumped `last_meaningful_progress_at` on every
    // descendant change — so by the time we knew it was Codex, the
    // progress clock was already set, and `deriveTelemetryStatus` kept
    // returning "progressing" via the stall-window check, painting the
    // session panel green "thinking" even though the user had never
    // typed a prompt.
    let nowMs = Date.parse("2026-04-16T00:00:00.000Z");
    const service = new TelemetryService({
      now: () => nowMs,
      processPollIntervalMs: 0,
    });
    // Step 1: terminal registers with provider=unknown (the real
    // registration path for terminalType=shell in main.ts:371).
    service.registerTerminal({
      terminalId: "codex-upgrade",
      worktreePath: "/repo",
      provider: "unknown",
    });
    service.recordPtyCreated({
      terminalId: "codex-upgrade",
      ptyId: 1,
      shellPid: 50,
    });

    // Step 2: a ps snapshot lands while we still think it's a shell.
    // Shell-mode ps churn is allowed to bump progress AND set
    // foreground_tool — that's correct for actual shells.
    service.recordProcessSnapshot(
      "codex-upgrade",
      {
        descendantProcesses: [
          { pid: 50, command: "bash", cli_type: null },
          { pid: 60, command: "npx @playwright/mcp-server", cli_type: null },
        ],
        foregroundTool: "npx @playwright/mcp-server",
      },
      "2026-04-16T00:00:01.000Z",
    );
    const afterPs = service.getTerminalSnapshot("codex-upgrade");
    // Sanity check: pre-upgrade state has the shell-mode signals set.
    assert.equal(afterPs?.foreground_tool, "npx @playwright/mcp-server");
    assert.equal(
      afterPs?.last_meaningful_progress_at,
      "2026-04-16T00:00:01.000Z",
    );

    // Step 3: CLI detection finishes, renderer calls telemetry.updateTerminal
    // with provider=codex. This is the moment my fix engages.
    service.updateTerminal({
      terminalId: "codex-upgrade",
      provider: "codex",
    });

    const upgraded = service.getTerminalSnapshot("codex-upgrade");
    // Those shell-mode signals were Codex's MCP daemon / boot noise,
    // not real work. Both must be cleared so the agent lifecycle
    // starts from a clean slate.
    assert.equal(upgraded?.foreground_tool, undefined);
    assert.equal(upgraded?.last_meaningful_progress_at, undefined);
    assert.equal(upgraded?.provider, "codex");
    // And the derived_status is back to a neutral "starting" instead of
    // the bogus "progressing" the stale progress timestamp used to
    // create.
    assert.notEqual(upgraded?.derived_status, "progressing");
    service.dispose();
  },
);

test(
  "SessionStart hook attaching clears ps-contaminated state even without a provider flip",
  () => {
    // Observed via DevTools: a Claude terminal registered with
    // provider="unknown" (because its terminalType wasn't "claude" at
    // registration time — e.g. created as shell that will be upgraded
    // later). ps bumped last_meaningful_progress_at during the unknown
    // window. Then Claude fired SessionStart with session_id, which
    // hit recordHookEvent SessionStart:
    //     const provider = state.snapshot.provider || "claude"
    // That "|| 'claude'" fallback only triggers for empty/null/undefined —
    // "unknown" is truthy, so the provider passed to
    // recordSessionAttached stays "unknown". My earlier unknown→agent
    // fix keys off the provider flip and therefore does NOT engage
    // here. The panel stayed green briefly until a later hook-session
    // upgrade path finally flipped provider→claude.
    //
    // Root fix: recordSessionAttached itself is a strong enough signal
    // that this is now an agent terminal. On first attach, clear ps
    // contamination regardless of what provider the caller passed.
    const service = new TelemetryService({ processPollIntervalMs: 0 });
    service.registerTerminal({
      terminalId: "claude-shell-upgrade",
      worktreePath: "/repo",
      // No provider → defaults to "unknown" (matches the registerTerminal
      // path in main.ts:371 for terminalType="shell").
    });
    service.recordPtyCreated({
      terminalId: "claude-shell-upgrade",
      ptyId: 9,
      shellPid: 77,
    });
    // ps fires while we still think it's a shell.
    service.recordProcessSnapshot(
      "claude-shell-upgrade",
      {
        descendantProcesses: [
          { pid: 77, command: "bash", cli_type: null },
          { pid: 88, command: "node claude-agent", cli_type: null },
        ],
        foregroundTool: "node claude-agent",
      },
      "2026-04-16T00:00:01.000Z",
    );
    const beforeAttach = service.getTerminalSnapshot("claude-shell-upgrade");
    assert.equal(beforeAttach?.foreground_tool, "node claude-agent");
    assert.equal(
      beforeAttach?.last_meaningful_progress_at,
      "2026-04-16T00:00:01.000Z",
    );

    // SessionStart hook arrives with session_id. recordHookEvent passes
    // state.snapshot.provider (still "unknown") through to
    // recordSessionAttached — the fallback "|| 'claude'" doesn't trigger
    // because "unknown" is truthy. So the attach happens while provider
    // is still "unknown", which is the path the old fix missed.
    service.recordHookEvent("claude-shell-upgrade", {
      hook_event_name: "SessionStart",
      session_id: "sess-claude",
    });

    const afterAttach = service.getTerminalSnapshot("claude-shell-upgrade");
    assert.equal(afterAttach?.session_attached, true);
    // The key assertions: attach itself clears ps noise even though
    // provider didn't transition unknown→agent in this path.
    assert.equal(afterAttach?.foreground_tool, undefined);
    assert.equal(afterAttach?.last_meaningful_progress_at, undefined);
    assert.notEqual(afterAttach?.derived_status, "progressing");
    service.dispose();
  },
);
