import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSpawnArgs,
  generateAgentId,
  buildGitWorktreeAddArgs,
  validateWorktreePath,
} from "../src/spawn.ts";

test("parseSpawnArgs extracts all flags correctly", () => {
  const args = parseSpawnArgs([
    "--task", "fix the bug",
    "--worker-type", "codex",
    "--repo", "/tmp/repo",
    "--base-branch", "develop",
  ]);
  assert.equal(args.task, "fix the bug");
  assert.equal(args.workerType, "codex");
  assert.equal(args.repo, "/tmp/repo");
  assert.equal(args.baseBranch, "develop");
  assert.equal(args.worktree, undefined);
});

test("parseSpawnArgs keeps kimi as the requested agent type", () => {
  const args = parseSpawnArgs([
    "--task", "explore the repo",
    "--type", "kimi",
    "--repo", "/tmp/repo",
  ]);
  assert.equal(args.workerType, "kimi");
});

test("parseSpawnArgs leaves worker type unset when the caller wants inheritance", () => {
  const args = parseSpawnArgs(["--task", "do stuff", "--repo", "/tmp/repo"]);
  assert.equal(args.workerType, undefined);
});

test("parseSpawnArgs with --worktree", () => {
  const args = parseSpawnArgs([
    "--task", "do stuff",
    "--repo", "/tmp/repo",
    "--worktree", "/tmp/repo/.worktrees/existing",
  ]);
  assert.equal(args.worktree, "/tmp/repo/.worktrees/existing");
});

test("parseSpawnArgs throws on missing --task", () => {
  assert.throws(
    () => parseSpawnArgs(["--repo", "/tmp/repo"]),
    /Missing required flag: --task/,
  );
});

test("parseSpawnArgs throws on missing --repo", () => {
  assert.throws(
    () => parseSpawnArgs(["--task", "do stuff"]),
    /Missing required flag: --repo/,
  );
});

test("generateAgentId returns hydra-prefixed ID", () => {
  const id = generateAgentId();
  assert.ok(id.startsWith("hydra-"), `Expected hydra- prefix, got: ${id}`);
});

test("generateAgentId returns unique IDs", () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateAgentId()));
  assert.equal(ids.size, 100);
});

test("buildGitWorktreeAddArgs preserves spaces and shell metacharacters", () => {
  const args = buildGitWorktreeAddArgs(
    "hydra/agent-1",
    "/tmp/dir with space",
    'feature/$(touch /tmp/pwned)`whoami`',
  );
  assert.deepStrictEqual(args, [
    "worktree",
    "add",
    "-b",
    "hydra/agent-1",
    "/tmp/dir with space",
    'feature/$(touch /tmp/pwned)`whoami`',
  ]);
});

test("validateWorktreePath accepts repo root and nested worktrees", () => {
  assert.equal(
    validateWorktreePath("/tmp/repo", "/tmp/repo"),
    "/tmp/repo",
  );
  assert.equal(
    validateWorktreePath("/tmp/repo", "/tmp/repo/.worktrees/existing"),
    "/tmp/repo/.worktrees/existing",
  );
});

test("validateWorktreePath rejects worktrees outside the repo", () => {
  assert.throws(
    () => validateWorktreePath("/tmp/repo", "/tmp/other-repo"),
    /must be inside the repo/,
  );
});
