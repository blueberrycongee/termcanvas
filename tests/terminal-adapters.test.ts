import test from "node:test";
import assert from "node:assert/strict";

import {
  getComposerAdapter,
  getTerminalLaunchOptions,
  isComposerSupportedTerminal,
} from "../src/terminal/cliConfig.ts";

test("claude adapter uses bracketed paste with image-path fallback", () => {
  const adapter = getComposerAdapter("claude");
  assert.ok(adapter);
  assert.equal(adapter.inputMode, "bracketed-paste");
  assert.equal(adapter.supportsImages, true);
  assert.equal(adapter.pasteKeySequence("darwin"), "");
  assert.equal(adapter.imageFallback, "image-path");
  assert.ok(adapter.allowedStatuses.includes("waiting"));
});

test("codex adapter uses bracketed paste with error fallback", () => {
  const adapter = getComposerAdapter("codex");
  assert.ok(adapter);
  assert.equal(adapter.inputMode, "bracketed-paste");
  assert.equal(adapter.supportsImages, true);
  assert.equal(adapter.pasteKeySequence("darwin"), "");
  assert.equal(adapter.pasteKeySequence("win32"), "");
  assert.equal(adapter.imageFallback, "error");
});

test("shell uses direct text composer mode without image support", () => {
  const adapter = getComposerAdapter("shell");
  assert.ok(adapter);
  assert.equal(adapter.inputMode, "type");
  assert.equal(adapter.supportsImages, false);
  assert.equal(isComposerSupportedTerminal("shell"), true);
});

test("agent terminals beyond claude/codex are composer-supported", () => {
  assert.equal(isComposerSupportedTerminal("kimi"), true);
  assert.equal(isComposerSupportedTerminal("gemini"), true);
  assert.equal(isComposerSupportedTerminal("opencode"), true);
});

test("getTerminalLaunchOptions reuses centralized launch config", () => {
  assert.deepEqual(getTerminalLaunchOptions("claude", undefined), {
    shell: "claude",
    args: [],
  });
  assert.deepEqual(getTerminalLaunchOptions("codex", "session-1"), {
    shell: "codex",
    args: ["resume", "session-1"],
  });
});
