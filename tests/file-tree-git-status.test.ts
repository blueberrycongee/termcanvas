import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyFileTreeDrop,
  buildFileTreeMoveRequests,
  buildPierreGitStatus,
} from "../src/components/RightPanel/FilesContent";
import type { GitStatusEntry } from "../src/types";

const entry = (path: string, status: GitStatusEntry["status"]): GitStatusEntry => ({
  path,
  status,
  staged: false,
});

test("file tree git status marks ignored files and explicit ignored directories", () => {
  const status = buildPierreGitStatus([], [], [
    "dist/",
    "dist/client/app.js",
    "debug.log",
  ]);

  assert.deepEqual(status, [
    { path: "dist/", status: "ignored" },
    { path: "dist/client/app.js", status: "ignored" },
    { path: "debug.log", status: "ignored" },
  ]);
});

test("file tree git status does not infer ignored ancestor directories", () => {
  assert.deepEqual(buildPierreGitStatus([], [], ["src/generated/out.js"]), [
    { path: "src/generated/out.js", status: "ignored" },
  ]);
});

test("file tree git status keeps the highest-priority staged or changed state", () => {
  const changed = [entry("src/app.ts", "M")];
  const staged = [entry("src/app.ts", "D")];

  assert.deepEqual(buildPierreGitStatus(changed, staged, []), [
    { path: "src/app.ts", status: "deleted" },
  ]);
});

test("file tree drop moves files and directory subtrees in path snapshots", () => {
  assert.deepEqual(
    applyFileTreeDrop(
      ["src/app.ts", "src/lib/index.ts", "README.md"],
      ["src/"],
      "packages/",
    ),
    ["packages/src/app.ts", "packages/src/lib/index.ts", "README.md"],
  );
});

test("file tree drop builds absolute filesystem move requests", () => {
  assert.deepEqual(
    buildFileTreeMoveRequests("/repo", ["src/app.ts", "docs/"], "packages/"),
    [
      { from: "/repo/src/app.ts", to: "/repo/packages/app.ts" },
      { from: "/repo/docs", to: "/repo/packages/docs" },
    ],
  );
});
