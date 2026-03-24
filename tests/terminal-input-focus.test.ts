import test from "node:test";
import assert from "node:assert/strict";

import { focusTerminalInputElement } from "../src/terminal/inputFocus.ts";

test("terminal focus prefers ghostty textarea so IME can attach", () => {
  let activeElement: unknown = null;
  let textareaFocused = 0;
  let terminalFocused = 0;
  let textareaFocusOptions: { preventScroll?: boolean } | undefined;
  const textareaStyle: Partial<CSSStyleDeclaration> = {};

  const textarea = {
    isConnected: true,
    style: textareaStyle,
    focus: (options?: { preventScroll?: boolean }) => {
      textareaFocused += 1;
      textareaFocusOptions = options;
      activeElement = textarea;
    },
  };

  const terminal = {
    textarea,
    cols: 80,
    rows: 24,
    renderer: {
      getCanvas: () => ({
        getBoundingClientRect: () => ({
          left: 100,
          top: 200,
          width: 800,
          height: 480,
        }),
      }),
    },
    wasmTerm: {
      getCursor: () => ({ x: 10, y: 5 }),
    },
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
  assert.equal(textareaStyle.position, "fixed");
  assert.equal(textareaStyle.left, "200px");
  assert.equal(textareaStyle.top, "300px");
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
