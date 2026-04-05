import test from "node:test";
import assert from "node:assert/strict";

import {
  clampPreviewAnsi,
  resolveTerminalMountMode,
  toPreviewText,
} from "../src/terminal/terminalRuntimePolicy.ts";

test("focused terminals stay live even when outside the viewport", () => {
  assert.equal(
    resolveTerminalMountMode({
      focused: true,
      visible: false,
    }),
    "live",
  );
});

test("visible non-focused terminals stay live", () => {
  assert.equal(
    resolveTerminalMountMode({
      focused: false,
      visible: true,
    }),
    "live",
  );
});

test("offscreen non-focused terminals detach their renderer", () => {
  assert.equal(
    resolveTerminalMountMode({
      focused: false,
      visible: false,
    }),
    "unmounted",
  );
});

test("preview text strips ANSI escapes and keeps the tail", () => {
  const preview = toPreviewText(
    "\u001b[31merror\u001b[0m\nline-1\nline-2\nline-3",
  );

  assert.equal(preview.includes("\u001b"), false);
  assert.match(preview, /error/);
  assert.match(preview, /line-3/);
});

test("serialized ANSI preview is capped to a bounded tail", () => {
  const oversized = "x".repeat(250_000);
  const capped = clampPreviewAnsi(oversized);

  assert.equal(capped.length, 200_000);
  assert.equal(capped, oversized.slice(50_000));
});

test("serialized ANSI preview does not start mid escape sequence", () => {
  const oversized = "x" + "\u001b[0m" + "y".repeat(199_997);
  const capped = clampPreviewAnsi(oversized);

  assert.equal(capped.startsWith("[0m"), false);
  assert.equal(capped.startsWith("y"), true);
  assert.equal(capped.length <= 200_000, true);
});
