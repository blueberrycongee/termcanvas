import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  checkTurnComplete,
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
