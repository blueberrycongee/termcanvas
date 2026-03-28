import test from "node:test";
import assert from "node:assert/strict";
import { stripAnsi } from "../src/terminal/smartRender/ansiStripper.ts";

test("strips SGR color codes", () => {
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m"), "red");
});

test("strips cursor movement sequences", () => {
  assert.equal(stripAnsi("\x1b[2Jhello"), "hello");
});

test("preserves plain text", () => {
  assert.equal(stripAnsi("hello world"), "hello world");
});

test("handles empty string", () => {
  assert.equal(stripAnsi(""), "");
});

test("strips multiple sequences in one string", () => {
  assert.equal(
    stripAnsi("\x1b[1m\x1b[34mbold blue\x1b[0m normal"),
    "bold blue normal",
  );
});
