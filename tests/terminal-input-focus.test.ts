import test from "node:test";
import assert from "node:assert/strict";

import { focusTerminalInputElement } from "../src/terminal/inputFocus.ts";

test("terminal focus prefers ghostty textarea so IME can attach", () => {
  let activeElement: unknown = null;
  let textareaFocused = 0;
  let terminalFocused = 0;
  let textareaFocusOptions: { preventScroll?: boolean } | undefined;

  const textarea = {
    isConnected: true,
    focus: (options?: { preventScroll?: boolean }) => {
      textareaFocused += 1;
      textareaFocusOptions = options;
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
  assert.deepEqual(textareaFocusOptions, { preventScroll: true });
});

test("terminal focus falls back to terminal.focus when textarea is unavailable", () => {
  let activeElement: unknown = null;
  let terminalFocused = 0;
  let terminalFocusOptions: { preventScroll?: boolean } | undefined;

  const terminal = {
    textarea: null,
    focus: (options?: { preventScroll?: boolean }) => {
      terminalFocused += 1;
      terminalFocusOptions = options;
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
  assert.deepEqual(terminalFocusOptions, { preventScroll: true });
});
