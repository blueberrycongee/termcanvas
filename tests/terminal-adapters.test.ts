import test from "node:test";
import assert from "node:assert/strict";

import {
  getComposerAdapter,
  getTerminalLaunchOptions,
  isComposerSupportedTerminal,
} from "../src/terminal/cliConfig.ts";

test("claude adapter exposes composer support and mac paste binding", () => {
  const adapter = getComposerAdapter("claude");
  assert.ok(adapter);
  assert.equal(adapter.pasteKeySequence("darwin"), "\u001bv");
  assert.equal(adapter.imageFallback, "image-path");
  assert.ok(adapter.allowedStatuses.includes("waiting"));
});

test("codex adapter uses ctrl-v paste on every platform", () => {
  const adapter = getComposerAdapter("codex");
  assert.ok(adapter);
  assert.equal(adapter.pasteKeySequence("darwin"), "\u0016");
  assert.equal(adapter.pasteKeySequence("win32"), "\u0016");
  assert.equal(adapter.imageFallback, "error");
});

test("shell is not composer-supported", () => {
  assert.equal(getComposerAdapter("shell"), null);
  assert.equal(isComposerSupportedTerminal("shell"), false);
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
