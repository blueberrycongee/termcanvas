import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionScanner } from "../electron/session-scanner.ts";

async function withTempHome(fn: (homeDir: string) => Promise<void>) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-session-scanner-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = homeDir;
  try {
    await fn(homeDir);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function writeJsonl(filePath: string, lines: object[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    lines.map((line) => JSON.stringify(line)).join("\n"),
    "utf-8",
  );
}

test("session scanner includes codex history alongside claude sessions", async () => {
  await withTempHome(async (homeDir) => {
    const claudeFile = path.join(
      homeDir,
      ".claude",
      "projects",
      "-tmp-claude-project",
      "claude-session.jsonl",
    );
    writeJsonl(claudeFile, [
      {
        timestamp: "2026-04-05T10:00:00.000Z",
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }], stop_reason: "end_turn" },
      },
    ]);

    const codexFile = path.join(
      homeDir,
      ".codex",
      "sessions",
      "2026",
      "04",
      "05",
      "codex-session.jsonl",
    );
    writeJsonl(codexFile, [
      {
        timestamp: "2026-04-05T10:01:00.000Z",
        type: "session_meta",
        payload: { cwd: "/tmp/codex-project" },
      },
      {
        timestamp: "2026-04-05T10:01:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pwd" }),
        },
      },
      {
        timestamp: "2026-04-05T10:01:02.000Z",
        type: "event_msg",
        payload: { type: "task_complete" },
      },
    ]);

    const scanner = new SessionScanner();
    const sessions = await new Promise<Awaited<ReturnType<SessionScanner["getSessions"]>>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        scanner.stop();
        reject(new Error("session scan timed out"));
      }, 2_000);

      scanner.start((results) => {
        clearTimeout(timeout);
        scanner.stop();
        resolve(results);
      });
    });

    assert.equal(sessions.length, 2);

    const codex = sessions.find((session) => session.sessionId === "codex-session");
    assert.ok(codex);
    assert.equal(codex.projectDir, "/tmp/codex-project");
    assert.equal(codex.status, "turn_complete");
    assert.equal(codex.currentTool, undefined);

    const claude = sessions.find((session) => session.sessionId === "claude-session");
    assert.ok(claude);
    assert.equal(claude.projectDir, "-tmp-claude-project");
  });
});

test("session scanner loads codex replay timelines", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-session-replay-"));
  const filePath = path.join(dir, "codex-session.jsonl");

  try {
    writeJsonl(filePath, [
      {
        timestamp: "2026-04-05T11:00:00.000Z",
        type: "session_meta",
        payload: { cwd: "/tmp/codex-project" },
      },
      {
        timestamp: "2026-04-05T11:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Fix the failing test" },
      },
      {
        timestamp: "2026-04-05T11:00:02.000Z",
        type: "response_item",
        payload: { type: "reasoning", summary: [{ text: "Inspecting logs" }] },
      },
      {
        timestamp: "2026-04-05T11:00:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "npm test" }),
        },
      },
      {
        timestamp: "2026-04-05T11:00:04.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          output: "Process exited with code 0",
        },
      },
      {
        timestamp: "2026-04-05T11:00:05.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ text: "All green." }],
        },
      },
      {
        timestamp: "2026-04-05T11:00:06.000Z",
        type: "event_msg",
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
      },
      {
        timestamp: "2026-04-05T11:00:07.000Z",
        type: "event_msg",
        payload: { type: "task_complete" },
      },
    ]);

    const scanner = new SessionScanner();
    const timeline = await scanner.loadReplay(filePath);

    assert.equal(timeline.projectDir, "/tmp/codex-project");
    assert.equal(timeline.totalTokens, 40);
    assert.deepEqual(
      timeline.events.map((event) => event.type),
      ["user_prompt", "thinking", "tool_use", "tool_result", "assistant_text", "turn_complete"],
    );
    assert.equal(timeline.events[0].textPreview, "Fix the failing test");
    assert.equal(timeline.events[2].toolName, "exec_command");
    assert.equal(timeline.events[2].textPreview, "$ npm test");
    assert.equal(timeline.events[4].textPreview, "All green.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
