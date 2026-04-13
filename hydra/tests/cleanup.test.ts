import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCleanupArgs,
  buildGitWorktreeRemoveArgs,
  buildGitBranchDeleteArgs,
  isLiveTerminalStatus,
} from "../src/cleanup.ts";

test("parseCleanupArgs with agent ID", () => {
  const result = parseCleanupArgs(["hydra-123-abcd"]);
  assert.equal(result.agentId, "hydra-123-abcd");
  assert.equal(result.all, false);
  assert.equal(result.force, false);
});

test("parseCleanupArgs with --all", () => {
  const result = parseCleanupArgs(["--all"]);
  assert.equal(result.agentId, undefined);
  assert.equal(result.all, true);
  assert.equal(result.force, false);
});

test("parseCleanupArgs with --all --force", () => {
  const result = parseCleanupArgs(["--all", "--force"]);
  assert.equal(result.all, true);
  assert.equal(result.force, true);
});

test("parseCleanupArgs throws with no args", () => {
  assert.throws(() => parseCleanupArgs([]), /agent ID, --workbench, or --all/);
});

test("parseCleanupArgs supports workbench cleanup", () => {
  const result = parseCleanupArgs(["--workbench", "workbench-123", "--repo", "/tmp/repo"]);
  assert.equal(result.workbenchId, "workbench-123");
  assert.equal(result.repo, "/tmp/repo");
  assert.equal(result.agentId, undefined);
});

test("buildGitWorktreeRemoveArgs preserves spaces in worktree path", () => {
  const args = buildGitWorktreeRemoveArgs("/tmp/dir with space");
  assert.deepStrictEqual(args, ["worktree", "remove", "/tmp/dir with space", "--force"]);
});

test("buildGitBranchDeleteArgs preserves shell metacharacters in branch name", () => {
  const args = buildGitBranchDeleteArgs('topic/$(touch /tmp/pwned)`uname`');
  assert.deepStrictEqual(args, ["branch", "-D", 'topic/$(touch /tmp/pwned)`uname`']);
});

test("isLiveTerminalStatus treats waiting as live but completed as safe to clean up", () => {
  assert.equal(isLiveTerminalStatus("running"), true);
  assert.equal(isLiveTerminalStatus("active"), true);
  assert.equal(isLiveTerminalStatus("waiting"), true);
  assert.equal(isLiveTerminalStatus("completed"), false);
  assert.equal(isLiveTerminalStatus("success"), false);
  assert.equal(isLiveTerminalStatus("error"), false);
  assert.equal(isLiveTerminalStatus("idle"), false);
});
