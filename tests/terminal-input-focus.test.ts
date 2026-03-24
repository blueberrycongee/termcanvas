import test from "node:test";
import assert from "node:assert/strict";

import { focusTerminalInputElement } from "../src/terminal/inputFocus.ts";

test("terminal focus prefers ghostty textarea so IME can attach", () => {
  let activeElement: unknown = null;
  let textareaFocused = 0;
  let terminalFocused = 0;

  const textarea = {
    isConnected: true,
    focus: () => {
      textareaFocused += 1;
      activeElement = textarea;
    },
  };

  const terminal = {
    textarea,
    focus: () => {
      terminalFocused += 1;
      activeElement = { kind: "terminal-shell" };
    },
  };

  const tile = {
    getClientRects: () => ({ length: 1 }),
    contains: (node: unknown) => node === textarea,
  };

  const focused = focusTerminalInputElement(
    terminal,
    tile,
    () => activeElement,
  );

  assert.equal(focused, true);
  assert.equal(textareaFocused, 1);
  assert.equal(terminalFocused, 0);
});

test("terminal focus falls back to terminal.focus when textarea is unavailable", () => {
  let activeElement: unknown = null;
  let terminalFocused = 0;

  const terminal = {
    textarea: null,
    focus: () => {
      terminalFocused += 1;
      activeElement = { kind: "terminal-root" };
    },
  };

  const tile = {
    getClientRects: () => ({ length: 1 }),
    contains: (node: unknown) => node === activeElement,
  };

  const focused = focusTerminalInputElement(
    terminal,
    tile,
    () => activeElement,
  );

  assert.equal(focused, true);
  assert.equal(terminalFocused, 1);
});
