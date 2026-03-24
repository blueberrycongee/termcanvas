import test from "node:test";
import assert from "node:assert/strict";

import {
  registerTerminal,
  serializeAllTerminals,
  serializeTerminal,
  unregisterTerminal,
} from "../src/terminal/terminalRegistry.ts";

test("serializeTerminal returns the registered value", () => {
  registerTerminal("terminal-1", () => "hello");
  assert.equal(serializeTerminal("terminal-1"), "hello");
  unregisterTerminal("terminal-1");
});

test("serializeAllTerminals preserves null for unsupported serializers", () => {
  registerTerminal("terminal-1", () => null);
  registerTerminal("terminal-2", () => "world");

  assert.deepEqual(serializeAllTerminals(), {
    "terminal-1": null,
    "terminal-2": "world",
  });

  unregisterTerminal("terminal-1");
  unregisterTerminal("terminal-2");
});
