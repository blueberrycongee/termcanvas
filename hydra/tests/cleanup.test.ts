import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseCleanupArgs,
  buildGitWorktreeRemoveArgs,
  buildGitBranchDeleteArgs,
  isLiveTerminalStatus,
  cleanupWorkbench,
} from "../src/cleanup.ts";
import {
  saveWorkbench,
  WORKBENCH_STATE_SCHEMA_VERSION,
  type WorkbenchRecord,
} from "../src/workflow-store.ts";

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

function makeRepoWithWorkbench(leadTerminalId: string): { repo: string; workbenchId: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-cleanup-guard-"));
  const workbenchId = "workbench-test";
  const workbench: WorkbenchRecord = {
    schema_version: WORKBENCH_STATE_SCHEMA_VERSION,
    id: workbenchId,
    lead_terminal_id: leadTerminalId,
    intent_file: "inputs/intent.md",
    repo_path: repo,
    worktree_path: repo,
    branch: null,
    base_branch: "main",
    own_worktree: false,
    created_at: "2026-04-10T00:00:00.000Z",
    updated_at: "2026-04-10T00:00:00.000Z",
    status: "active",
    dispatches: {},
    default_timeout_minutes: 30,
    default_max_retries: 1,
    auto_approve: true,
  };
  saveWorkbench(workbench);
  return { repo, workbenchId };
}

function withTerminalId<T>(terminalId: string | undefined, fn: () => T): T {
  const previous = process.env.TERMCANVAS_TERMINAL_ID;
  if (terminalId === undefined) {
    delete process.env.TERMCANVAS_TERMINAL_ID;
  } else {
    process.env.TERMCANVAS_TERMINAL_ID = terminalId;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.TERMCANVAS_TERMINAL_ID;
    } else {
      process.env.TERMCANVAS_TERMINAL_ID = previous;
    }
  }
}

test("cleanupWorkbench rejects a non-Lead terminal before any destructive work", () => {
  const { repo, workbenchId } = makeRepoWithWorkbench("terminal-lead");
  try {
    withTerminalId("terminal-intruder", () => {
      assert.throws(
        () => cleanupWorkbench(workbenchId, repo, false),
        (err: Error & { errorCode?: string }) => {
          assert.equal(err.errorCode, "WORKBENCH_NOT_LEAD");
          return true;
        },
      );
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("cleanupWorkbench permits tooling/scripts without TERMCANVAS_TERMINAL_ID", () => {
  const { repo, workbenchId } = makeRepoWithWorkbench("terminal-lead");
  try {
    // Without TERMCANVAS_TERMINAL_ID the guard is permissive by design (see
    // lead-guard.ts). cleanupWorkbench therefore reaches its isTermCanvasRunning
    // branch and proceeds; the workbench has no dispatches, so the only
    // possible side-effect is log output. We assert the guard does not throw.
    withTerminalId(undefined, () => {
      assert.doesNotThrow(() => cleanupWorkbench(workbenchId, repo, false));
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
