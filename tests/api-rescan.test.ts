import test from "node:test";
import assert from "node:assert/strict";
import { ProjectScanner } from "../electron/project-scanner.ts";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function withTempRepo(fn: (repoPath: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rescan-test-"));
  try {
    execSync("git init && git commit --allow-empty -m init", {
      cwd: dir,
      stdio: "pipe",
    });
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("listWorktrees detects newly added worktree", () => {
  withTempRepo((repo) => {
    const scanner = new ProjectScanner();
    const before = scanner.listWorktrees(repo);
    assert.equal(before.length, 1);

    const wtPath = path.join(repo, ".worktrees", "test-wt");
    execSync(`git worktree add "${wtPath}" -b test-branch`, {
      cwd: repo,
      stdio: "pipe",
    });

    const after = scanner.listWorktrees(repo);
    assert.equal(after.length, 2);
    const realWtPath = fs.realpathSync(wtPath);
    assert.ok(after.some((w) => w.path === realWtPath));
  });
});
