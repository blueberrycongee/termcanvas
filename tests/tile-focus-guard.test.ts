import test from "node:test";
import assert from "node:assert/strict";

import { shouldSkipTerminalTileFocus } from "../src/terminal/tileFocusGuard.ts";

test("terminal tile focus skips clicks from the custom title area", () => {
  const target = {
    closest: (selector: string) =>
      selector === "[data-terminal-custom-title-interaction]" ? {} : null,
  } as EventTarget;

  assert.equal(shouldSkipTerminalTileFocus(target), true);
});

test("terminal tile focus keeps normal clicks focusable", () => {
  const target = {
    closest: () => null,
  } as EventTarget;

  assert.equal(shouldSkipTerminalTileFocus(target), false);
});

test("terminal tile focus handles non-element targets", () => {
  assert.equal(shouldSkipTerminalTileFocus(null), false);
  assert.equal(shouldSkipTerminalTileFocus({} as EventTarget), false);
});
