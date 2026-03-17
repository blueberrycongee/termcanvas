import test from "node:test";
import assert from "node:assert/strict";
import { buildSpawnPrompt } from "../src/prompt.ts";

test("buildSpawnPrompt includes task and worktree context", () => {
  const result = buildSpawnPrompt({
    task: "Fix the login bug",
    worktreePath: "/tmp/repo/.worktrees/hydra-abc123",
    branch: "hydra/hydra-abc123",
    baseBranch: "main",
  });
  assert.ok(result.includes("Fix the login bug"));
  assert.ok(result.includes("/tmp/repo/.worktrees/hydra-abc123"));
  assert.ok(result.includes("hydra/hydra-abc123"));
  assert.ok(result.includes("main"));
});

test("buildSpawnPrompt handles null branch (existing worktree)", () => {
  const result = buildSpawnPrompt({
    task: "Refactor utils",
    worktreePath: "/tmp/repo/.worktrees/existing",
    branch: null,
    baseBranch: "develop",
  });
  assert.ok(result.includes("(existing worktree)"));
  assert.ok(result.includes("Refactor utils"));
  assert.ok(result.includes("develop"));
});

test("buildSpawnPrompt includes safety rules", () => {
  const result = buildSpawnPrompt({
    task: "Do something",
    worktreePath: "/tmp/wt",
    branch: "hydra/test",
    baseBranch: "main",
  });
  assert.ok(result.includes("Do not push to remote"));
  assert.ok(result.includes("Commit your changes"));
});
