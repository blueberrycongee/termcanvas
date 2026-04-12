import test from "node:test";
import assert from "node:assert/strict";

import {
  getComposerAdapter,
  getTerminalLaunchOptions,
  getTerminalPromptArgs,
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
  assert.equal(isComposerSupportedTerminal("wuu"), true);
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

test("getTerminalLaunchOptions applies cliOverride command", () => {
  const result = getTerminalLaunchOptions("claude", undefined, false, {
    command: "/custom/bin/claude",
    args: [],
  });
  assert.ok(result);
  assert.equal(result.shell, "/custom/bin/claude");
  assert.deepEqual(result.args, []);
});

test("getTerminalLaunchOptions prepends cliOverride args", () => {
  const result = getTerminalLaunchOptions("claude", "session-1", false, {
    command: "claude",
    args: ["--extra"],
  });
  assert.ok(result);
  assert.equal(result.shell, "claude");
  assert.deepEqual(result.args, ["--extra", "--resume", "session-1"]);
});

test("getTerminalLaunchOptions includes autoApprove args for new claude session", () => {
  const result = getTerminalLaunchOptions("claude", undefined, true);
  assert.ok(result);
  assert.deepEqual(result.args, ["--dangerously-skip-permissions"]);
});

test("getTerminalLaunchOptions includes autoApprove args when resuming claude session", () => {
  const result = getTerminalLaunchOptions("claude", "session-1", true);
  assert.ok(result);
  assert.deepEqual(result.args, [
    "--dangerously-skip-permissions",
    "--resume",
    "session-1",
  ]);
});

test("getTerminalLaunchOptions includes autoApprove args when resuming codex session", () => {
  const result = getTerminalLaunchOptions("codex", "session-1", true);
  assert.ok(result);
  assert.deepEqual(result.args, [
    "--dangerously-bypass-approvals-and-sandbox",
    "resume",
    "session-1",
  ]);
});

test("getTerminalPromptArgs defaults to a positional prompt", () => {
  assert.deepEqual(getTerminalPromptArgs("claude", "Explore the repo"), [
    "Explore the repo",
  ]);
});

test("getTerminalPromptArgs uses kimi's explicit prompt flag", () => {
  assert.deepEqual(getTerminalPromptArgs("kimi", "Explore the repo"), [
    "--prompt",
    "Explore the repo",
  ]);
});
