import test from "node:test";
import assert from "node:assert/strict";

import {
  handleTerminalCustomKeyEvent,
  KILL_LINE_SEQUENCE,
} from "../src/terminal/keyHandling.ts";

test("Command+Backspace sends kill-line and prevents default terminal handling", () => {
  const writes: string[] = [];

  const prevented = handleTerminalCustomKeyEvent(
    {
      type: "keydown",
      metaKey: true,
      key: "Backspace",
    },
    (data) => writes.push(data),
  );

  assert.equal(prevented, true);
  assert.deepEqual(writes, [KILL_LINE_SEQUENCE]);
});

test("regular terminal input is not intercepted by the custom key handler", () => {
  const writes: string[] = [];

  const prevented = handleTerminalCustomKeyEvent(
    {
      type: "keydown",
      metaKey: false,
      key: "a",
    },
    (data) => writes.push(data),
  );

  assert.equal(prevented, false);
  assert.deepEqual(writes, []);
});

test("other command shortcuts fall through to normal terminal/browser handling", () => {
  const writes: string[] = [];

  const prevented = handleTerminalCustomKeyEvent(
    {
      type: "keydown",
      metaKey: true,
      key: "c",
    },
    (data) => writes.push(data),
  );

  assert.equal(prevented, false);
  assert.deepEqual(writes, []);
});
