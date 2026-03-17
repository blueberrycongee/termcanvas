import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonOrDie,
  buildTermcanvasArgs,
  buildTerminalCreateArgs,
  buildTerminalInputArgs,
} from "../src/termcanvas.ts";

test("parseJsonOrDie parses valid JSON", () => {
  const result = parseJsonOrDie('{"id":"abc","status":"running"}');
  assert.deepStrictEqual(result, { id: "abc", status: "running" });
});

test("parseJsonOrDie throws on invalid JSON", () => {
  assert.throws(() => parseJsonOrDie("not json"), /Failed to parse/);
});

test("buildTermcanvasArgs builds correct args", () => {
  const args = buildTermcanvasArgs("terminal", "status", ["tc-001"]);
  assert.deepStrictEqual(args, ["terminal", "status", "tc-001", "--json"]);
});

test("buildTerminalCreateArgs preserves spaces in worktree path as one argv entry", () => {
  const args = buildTerminalCreateArgs("/tmp/dir with space", "codex");
  assert.deepStrictEqual(args, [
    "terminal",
    "create",
    "--worktree",
    "/tmp/dir with space",
    "--type",
    "codex",
    "--json",
  ]);
});

test("buildTerminalInputArgs preserves shell metacharacters as literal text", () => {
  const args = buildTerminalInputArgs("tc-001", 'do $(touch /tmp/pwned) `uname`');
  assert.deepStrictEqual(args, [
    "terminal",
    "input",
    "tc-001",
    'do $(touch /tmp/pwned) `uname`',
    "--json",
  ]);
});
