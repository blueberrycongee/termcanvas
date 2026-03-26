import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  checkTurnComplete,
  parseSessionTelemetryLine,
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

// --- Claude Code tests ---

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

// --- Codex tests ---

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

// --- Edge cases ---

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
