import test from "node:test";
import assert from "node:assert/strict";

import * as inputFocus from "../src/terminal/inputFocus.ts";

test("ghostty mount suppresses auto-focus during open without breaking later explicit focus", () => {
  assert.equal(
    typeof (inputFocus as Record<string, unknown>).openTerminalWithoutMountAutoFocus,
    "function",
  );

  const openTerminalWithoutMountAutoFocus = (
    inputFocus as {
      openTerminalWithoutMountAutoFocus: (
        terminal: {
          open: (parent: HTMLElement) => void;
          focus: () => void;
        },
        parent: HTMLElement,
      ) => void;
    }
  ).openTerminalWithoutMountAutoFocus;

  let opened = 0;
  let focused = 0;

  const terminal = {
    open(parent: HTMLElement) {
      opened += 1;
      assert.equal(parent, container);
      this.focus();
    },
    focus() {
      focused += 1;
    },
  };

  const container = {} as HTMLElement;

  openTerminalWithoutMountAutoFocus(terminal, container);

  assert.equal(opened, 1);
  assert.equal(focused, 0);

  terminal.focus();
  assert.equal(focused, 1);
});
