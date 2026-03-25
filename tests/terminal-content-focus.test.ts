import test from "node:test";
import assert from "node:assert/strict";

import { focusTerminalContentTarget } from "../src/terminal/contentFocus.ts";

test("shell terminals focus terminal input directly on content mouse down", () => {
  let focusedTerminal = 0;
  let focusedTerminalInput = 0;

  const result = focusTerminalContentTarget("shell", true, {
    focusTerminal: () => {
      focusedTerminal += 1;
    },
    focusTerminalInput: () => {
      focusedTerminalInput += 1;
    },
  });

  assert.equal(result, "terminal-input");
  assert.equal(focusedTerminal, 0);
  assert.equal(focusedTerminalInput, 1);
});

test("AI terminals with composer enabled focus the composer path on content mouse down", () => {
  let focusedTerminal = 0;
  let focusedTerminalInput = 0;

  const result = focusTerminalContentTarget("claude", true, {
    focusTerminal: () => {
      focusedTerminal += 1;
    },
    focusTerminalInput: () => {
      focusedTerminalInput += 1;
    },
  });

  assert.equal(result, "composer");
  assert.equal(focusedTerminal, 1);
  assert.equal(focusedTerminalInput, 0);
});

test("AI terminals without composer enabled still focus terminal input directly", () => {
  let focusedTerminal = 0;
  let focusedTerminalInput = 0;

  const result = focusTerminalContentTarget("codex", false, {
    focusTerminal: () => {
      focusedTerminal += 1;
    },
    focusTerminalInput: () => {
      focusedTerminalInput += 1;
    },
  });

  assert.equal(result, "terminal-input");
  assert.equal(focusedTerminal, 0);
  assert.equal(focusedTerminalInput, 1);
});
