import test from "node:test";
import assert from "node:assert/strict";

import { resolveTerminalBackendPreference } from "../src/terminal/backend.ts";

test("resolveTerminalBackendPreference defaults to ghostty", () => {
  assert.equal(resolveTerminalBackendPreference({}), "ghostty");
});

test("resolveTerminalBackendPreference honors an explicit backend", () => {
  assert.equal(
    resolveTerminalBackendPreference({ terminalBackend: "xterm" }),
    "xterm",
  );
});

test("resolveTerminalBackendPreference migrates legacy terminalRenderer", () => {
  assert.equal(
    resolveTerminalBackendPreference({ terminalRenderer: "xterm" }),
    "xterm",
  );
});
