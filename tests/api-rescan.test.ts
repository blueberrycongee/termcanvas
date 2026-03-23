import test from "node:test";
import assert from "node:assert/strict";
import { ProjectScanner } from "../electron/project-scanner.ts";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function withTempRepo(
  fn: (repoPath: string) => void | Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rescan-test-"));
  try {
    execSync("git init && git commit --allow-empty -m init", {
      cwd: dir,
      stdio: "pipe",
    });
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("listWorktreesAsync detects newly added worktree", async () => {
  await withTempRepo(async (repo) => {
    const scanner = new ProjectScanner();
    const before = await scanner.listWorktreesAsync(repo);
    assert.equal(before.length, 1);

    const wtPath = path.join(repo, ".worktrees", "test-wt");
    execSync(`git worktree add "${wtPath}" -b test-branch`, {
      cwd: repo,
      stdio: "pipe",
    });

    const after = await scanner.listWorktreesAsync(repo);
    assert.equal(after.length, 2);
    const realWtPath = fs.realpathSync(wtPath);
    assert.ok(after.some((w) => w.path === realWtPath));
  });
});

test("scanAsync returns null for non-git directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rescan-non-git-"));
  try {
    const scanner = new ProjectScanner();
    const result = await scanner.scanAsync(dir);
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("scanAsync preserves scan semantics for git repos", async () => {
  await withTempRepo(async (repo) => {
    const scanner = new ProjectScanner();
    const syncResult = scanner.scan(repo);
    const asyncResult = await scanner.scanAsync(repo);
    assert.deepEqual(asyncResult, syncResult);
  });
});
