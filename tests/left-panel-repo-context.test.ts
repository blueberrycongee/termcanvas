import test from "node:test";
import assert from "node:assert/strict";

import { resolveRepoContext } from "../src/components/LeftPanel/repoContext.ts";

test("resolveRepoContext keeps the directory path when the directory is a git repo", () => {
  assert.deepEqual(
    resolveRepoContext({
      childRepos: [{ name: "frontend", path: "/tmp/acme/frontend" }],
      directoryIsGitRepo: true,
      directoryPath: "/tmp/acme",
      preferredRepoPath: "/tmp/acme/frontend",
    }),
    {
      selectedRepoPath: null,
      selectorKind: "none",
      targetPath: "/tmp/acme",
    },
  );
});

test("resolveRepoContext selects the preferred child repo when available", () => {
  assert.deepEqual(
    resolveRepoContext({
      childRepos: [
        { name: "backend", path: "/tmp/acme/backend" },
        { name: "frontend", path: "/tmp/acme/frontend" },
      ],
      directoryIsGitRepo: false,
      directoryPath: "/tmp/acme",
      preferredRepoPath: "/tmp/acme/frontend",
    }),
    {
      selectedRepoPath: "/tmp/acme/frontend",
      selectorKind: "inline",
      targetPath: "/tmp/acme/frontend",
    },
  );
});

test("resolveRepoContext falls back to the first child repo when no preference exists", () => {
  assert.deepEqual(
    resolveRepoContext({
      childRepos: [{ name: "frontend", path: "/tmp/acme/frontend" }],
      directoryIsGitRepo: false,
      directoryPath: "/tmp/acme",
    }),
    {
      selectedRepoPath: "/tmp/acme/frontend",
      selectorKind: "single",
      targetPath: "/tmp/acme/frontend",
    },
  );
});

test("resolveRepoContext uses dropdown mode when there are many child repos", () => {
  assert.deepEqual(
    resolveRepoContext({
      childRepos: [
        { name: "api", path: "/tmp/acme/api" },
        { name: "frontend", path: "/tmp/acme/frontend" },
        { name: "worker", path: "/tmp/acme/worker" },
      ],
      directoryIsGitRepo: false,
      directoryPath: "/tmp/acme",
      preferredRepoPath: "/tmp/acme/worker",
    }),
    {
      selectedRepoPath: "/tmp/acme/worker",
      selectorKind: "dropdown",
      targetPath: "/tmp/acme/worker",
    },
  );
});
