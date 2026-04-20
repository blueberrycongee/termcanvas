import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

import {
  checkTurnComplete,
  parseSessionTelemetryLine,
  resolveSessionFile,
  toClaudeProjectKey,
} from "../electron/session-watcher.ts";

function withTempFile(content: string, fn: (filePath: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-watcher-"));
  const filePath = path.join(dir, "test.jsonl");
  fs.writeFileSync(filePath, content, "utf-8");
  try {
    fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

function withTempHome(fn: (homeDir: string) => void): void {
  const homeDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "session-watcher-home-"),
  );
  const previousHome = process.env.HOME;
  process.env.HOME = homeDir;
  try {
    fn(homeDir);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function writeStateDbThread(
  homeDir: string,
  input: {
    sessionId: string;
    cwd: string;
    rolloutPath: string;
  },
): void {
  const dbPath = path.join(homeDir, ".codex", "state_5.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        cwd TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.prepare(`
      INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, archived)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(
      input.sessionId,
      input.rolloutPath,
      1775339237,
      1775339238,
      input.cwd,
    );
  } finally {
    db.close();
  }
}

test("claude: detects end_turn stop_reason", () => {
  const jsonl = [
    JSON.stringify({ type: "user", message: { content: "hello" } }),
    JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn", content: "hi" },
    }),
  ].join("\n");

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "claude");
    assert.equal(result.completed, true);
  });
});

test("claude: detects turn_duration system message", () => {
  const jsonl = [
    JSON.stringify({ type: "user", message: { content: "hello" } }),
    JSON.stringify({ type: "assistant", message: { stop_reason: "end_turn" } }),
    JSON.stringify({ type: "system", subtype: "turn_duration", duration: 5.2 }),
  ].join("\n");

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "claude");
    assert.equal(result.completed, true);
  });
});

test("claude: not completed when assistant has no end_turn", () => {
  const jsonl = [
    JSON.stringify({ type: "user", message: { content: "hello" } }),
    JSON.stringify({
      type: "assistant",
      message: { stop_reason: "max_tokens", content: "..." },
    }),
  ].join("\n");

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "claude");
    assert.equal(result.completed, false);
  });
});

test("claude: not completed when only user messages", () => {
  const jsonl = JSON.stringify({
    type: "user",
    message: { content: "hello" },
  });

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "claude");
    assert.equal(result.completed, false);
  });
});

test("codex: detects task_complete event", () => {
  const jsonl = [
    JSON.stringify({ type: "event_msg", payload: { type: "task_start" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }),
  ].join("\n");

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "codex");
    assert.equal(result.completed, true);
  });
});

test("codex resolveSessionFile prefers rollout_path from state db before the file exists", () => {
  withTempHome((homeDir) => {
    const sessionId = "db-session";
    const rolloutPath = path.join(
      homeDir,
      ".codex",
      "sessions",
      "2026",
      "04",
      "20",
      `rollout-2026-04-20T03-00-00-${sessionId}.jsonl`,
    );

    writeStateDbThread(homeDir, {
      sessionId,
      cwd: "/tmp/project-db",
      rolloutPath,
    });

    assert.equal(fs.existsSync(rolloutPath), false);
    assert.equal(
      resolveSessionFile(sessionId, "codex", "/tmp/project-db"),
      rolloutPath,
    );
  });
});

test("codex: detects turn_complete alias event", () => {
  const jsonl = [
    JSON.stringify({ type: "event_msg", payload: { type: "task_start" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "turn_complete" } }),
  ].join("\n");

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "codex");
    assert.equal(result.completed, true);
  });
});

test("codex: not completed without task_complete", () => {
  const jsonl = [
    JSON.stringify({ type: "event_msg", payload: { type: "task_start" } }),
    JSON.stringify({ type: "event_msg", payload: { type: "output" } }),
  ].join("\n");

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "codex");
    assert.equal(result.completed, false);
  });
});

test("returns false for empty file", () => {
  withTempFile("", (filePath) => {
    const result = checkTurnComplete(filePath, "claude");
    assert.equal(result.completed, false);
  });
});

test("returns false for nonexistent file", () => {
  const result = checkTurnComplete("/nonexistent/path.jsonl", "claude");
  assert.equal(result.completed, false);
});

test("returns false for invalid JSON lines", () => {
  withTempFile("not valid json\nalso not json\n", (filePath) => {
    const result = checkTurnComplete(filePath, "claude");
    assert.equal(result.completed, false);
  });
});

test("claude: detects completion with mixed valid/invalid lines at tail", () => {
  const jsonl = [
    "invalid line",
    JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn", content: "done" },
    }),
    "another invalid line",
  ].join("\n");

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "claude");
    assert.equal(result.completed, true);
  });
});

test("claude project key normalizes POSIX paths", () => {
  assert.equal(
    toClaudeProjectKey("/Users/foo/my.app"),
    "-Users-foo-my-app",
  );
});

test("claude project key normalizes Windows paths", () => {
  assert.equal(
    toClaudeProjectKey("C:\\Users\\foo\\project"),
    "C--Users-foo-project",
  );
});

test("claude telemetry parser marks thinking and tool_pending distinctly", () => {
  const events = parseSessionTelemetryLine(
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-03-26T00:00:00.000Z",
      message: {
        stop_reason: "tool_use",
        content: [
          { type: "thinking", thinking: "working" },
          { type: "tool_use", name: "Bash" },
        ],
      },
    }),
    "claude",
  );

  assert.deepEqual(
    events.map((event) => [event.event_type, event.turn_state]),
    [
      ["thinking", "thinking"],
      ["tool_use", "tool_running"],
      ["assistant_stop", "tool_pending"],
    ],
  );
});

test("claude telemetry parser treats tool_result as meaningful progress", () => {
  const events = parseSessionTelemetryLine(
    JSON.stringify({
      type: "user",
      timestamp: "2026-03-26T00:00:02.000Z",
      toolUseResult: { status: "async_launched" },
      message: {
        content: [{ type: "tool_result", content: "started" }],
      },
    }),
    "claude",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "tool_result");
  assert.equal(events[0].turn_state, "tool_running");
  assert.equal(events[0].meaningful_progress, true);
});

test("codex telemetry parser extracts token totals and thinking state", () => {
  const tokenEvents = parseSessionTelemetryLine(
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-03-26T00:00:03.000Z",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 10,
            output_tokens: 20,
            cached_input_tokens: 3,
            reasoning_output_tokens: 7,
          },
        },
      },
    }),
    "codex",
  );
  const reasoningEvents = parseSessionTelemetryLine(
    JSON.stringify({
      type: "response_item",
      timestamp: "2026-03-26T00:00:04.000Z",
      payload: { type: "reasoning", summary: [] },
    }),
    "codex",
  );

  assert.equal(tokenEvents[0].token_total, 40);
  assert.equal(reasoningEvents[0].turn_state, "thinking");
  assert.equal(reasoningEvents[0].meaningful_progress, true);
});

test("codex telemetry parser captures exec_command_end lifecycle and status", () => {
  const events = parseSessionTelemetryLine(
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-03-26T00:00:05.000Z",
      payload: {
        type: "exec_command_end",
        call_id: "call-1",
        status: "completed",
      },
    }),
    "codex",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "exec_command_end");
  assert.equal(events[0].tool_name, "exec_command");
  assert.equal(events[0].call_id, "call-1");
  assert.equal(events[0].lifecycle, "end");
  assert.equal(events[0].event_subtype, "completed");
  assert.equal(events[0].turn_state, "in_turn");
});

test("wuu: detects completion when the latest relevant line is a plain assistant reply", () => {
  const jsonl = [
    JSON.stringify({ role: "user", content: "你是谁", at: "2026-04-11T10:00:00Z" }),
    JSON.stringify({
      role: "assistant",
      content: "我是 Wuu。",
      at: "2026-04-11T10:00:01Z",
    }),
    JSON.stringify({ role: "meta", content: "token_usage", at: "2026-04-11T10:00:01Z" }),
  ].join("\n");

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "wuu");
    assert.equal(result.completed, true);
  });
});

test("wuu: does not report completion while a tool result is the latest relevant event", () => {
  const jsonl = [
    JSON.stringify({ role: "user", content: "list files", at: "2026-04-11T10:00:00Z" }),
    JSON.stringify({
      role: "assistant",
      content: "",
      at: "2026-04-11T10:00:01Z",
      tool_calls: [{ id: "call-1", name: "list_files" }],
    }),
    JSON.stringify({
      role: "tool",
      content: "{\"entries\":[]}",
      at: "2026-04-11T10:00:02Z",
      tool_call_id: "call-1",
      name: "list_files",
    }),
  ].join("\n");

  withTempFile(jsonl, (filePath) => {
    const result = checkTurnComplete(filePath, "wuu");
    assert.equal(result.completed, false);
  });
});

test("wuu telemetry parser tracks tool lifecycle and final assistant completion", () => {
  const toolStart = parseSessionTelemetryLine(
    JSON.stringify({
      role: "assistant",
      content: "",
      at: "2026-04-11T10:00:01Z",
      tool_calls: [{ id: "call-1", name: "list_files" }],
    }),
    "wuu",
  );
  const toolEnd = parseSessionTelemetryLine(
    JSON.stringify({
      role: "tool",
      content: "{\"entries\":[]}",
      at: "2026-04-11T10:00:02Z",
      tool_call_id: "call-1",
      name: "list_files",
    }),
    "wuu",
  );
  const assistantReply = parseSessionTelemetryLine(
    JSON.stringify({
      role: "assistant",
      content: "Done.",
      at: "2026-04-11T10:00:03Z",
    }),
    "wuu",
  );

  assert.deepEqual(toolStart, [
    {
      at: "2026-04-11T10:00:01Z",
      event_type: "tool_use",
      role: "assistant",
      tool_name: "list_files",
      call_id: "call-1",
      lifecycle: "start",
      turn_state: "tool_running",
      meaningful_progress: true,
    },
  ]);
  assert.deepEqual(toolEnd, [
    {
      at: "2026-04-11T10:00:02Z",
      event_type: "tool_result",
      role: "tool",
      tool_name: "list_files",
      call_id: "call-1",
      lifecycle: "end",
      turn_state: "in_turn",
      meaningful_progress: true,
    },
  ]);
  assert.deepEqual(assistantReply, [
    {
      at: "2026-04-11T10:00:03Z",
      event_type: "assistant_message",
      role: "assistant",
      turn_state: "turn_complete",
      meaningful_progress: true,
    },
  ]);
});
