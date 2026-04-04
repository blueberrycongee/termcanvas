import test from "node:test";
import assert from "node:assert/strict";

import { parseGitStatusOutput } from "../electron/git-info.ts";

test("parseGitStatusOutput parses modified staged and unstaged files", () => {
  const raw = "MM file.ts\0";
  const entries = parseGitStatusOutput(raw);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { path: "file.ts", status: "M", staged: true });
  assert.deepEqual(entries[1], { path: "file.ts", status: "M", staged: false });
});

test("parseGitStatusOutput parses untracked files", () => {
  const raw = "?? newfile.ts\0";
  const entries = parseGitStatusOutput(raw);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { path: "newfile.ts", status: "?", staged: false });
});

test("parseGitStatusOutput parses added staged file", () => {
  const raw = "A  staged.ts\0";
  const entries = parseGitStatusOutput(raw);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { path: "staged.ts", status: "A", staged: true });
});

test("parseGitStatusOutput parses deleted unstaged file", () => {
  const raw = " D removed.ts\0";
  const entries = parseGitStatusOutput(raw);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { path: "removed.ts", status: "D", staged: false });
});

test("parseGitStatusOutput parses rename in index", () => {
  // "R  new.ts\0old.ts\0" — rename with extra path for original
  const raw = "R  new.ts\0old.ts\0";
  const entries = parseGitStatusOutput(raw);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    path: "new.ts",
    status: "R",
    staged: true,
    originalPath: "old.ts",
  });
});

test("parseGitStatusOutput handles multiple files", () => {
  const raw = "M  a.ts\0 M b.ts\0?? c.ts\0A  d.ts\0";
  const entries = parseGitStatusOutput(raw);

  assert.equal(entries.length, 4);
  assert.equal(entries[0].path, "a.ts");
  assert.equal(entries[0].staged, true);
  assert.equal(entries[1].path, "b.ts");
  assert.equal(entries[1].staged, false);
  assert.equal(entries[2].path, "c.ts");
  assert.equal(entries[2].status, "?");
  assert.equal(entries[3].path, "d.ts");
  assert.equal(entries[3].status, "A");
});

test("parseGitStatusOutput returns empty array for empty input", () => {
  assert.deepEqual(parseGitStatusOutput(""), []);
});
