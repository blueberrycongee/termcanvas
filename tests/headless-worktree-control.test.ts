import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ProjectScanner } from "../electron/project-scanner.ts";
import {
  createWorkspaceFixture,
  startHeadlessServer,
  stopHeadlessServer,
} from "./headless-runtime-test-helpers.ts";

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    body: await response.json(),
  };
}

function initRepo(repoPath: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repoPath,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "TermCanvas Test"], {
    cwd: repoPath,
    stdio: "pipe",
  });
  fs.writeFileSync(path.join(repoPath, "README.md"), "hello\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath, stdio: "pipe" });
}

test("worktree routes create, list, and remove git worktrees while syncing project state", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const harness = await startHeadlessServer({
    workspaceDir,
    projectScanner: new ProjectScanner(),
  });

  try {
    const created = await fetchJson(`${harness.baseUrl}/worktree/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: repoPath,
        branch: "feature/cloud",
      }),
    });

    assert.equal(created.status, 200);
    assert.ok(fs.existsSync(created.body.path));
    assert.equal(created.body.branch, "feature/cloud");
    assert.equal(harness.projectStore.getProjects().length, 1);
    assert.equal(harness.projectStore.getProjects()[0].worktrees.length, 2);

    const listed = await fetchJson(
      `${harness.baseUrl}/worktree/list?repo=${encodeURIComponent(repoPath)}`,
    );
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 2);
    assert.equal(
      listed.body.some((worktree: { branch: string }) => worktree.branch === "feature/cloud"),
      true,
    );

    const removed = await fetchJson(
      `${harness.baseUrl}/worktree?repo=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(created.body.path)}&force=true`,
      {
        method: "DELETE",
      },
    );
    assert.equal(removed.status, 200);
    assert.equal(removed.body.ok, true);
    assert.equal(fs.existsSync(created.body.path), false);
    assert.equal(harness.projectStore.getProjects()[0].worktrees.length, 1);
  } finally {
    await stopHeadlessServer(harness);
  }
});
