import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

test("workflow routes auto-track the repo and can complete a single-step run", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const worktrees = [
    { path: repoPath, branch: "main", isMain: true },
  ];

  const harness = await startHeadlessServer({
    workspaceDir,
    projectScanner: {
      scan(dirPath: string) {
        if (path.resolve(dirPath) !== repoPath) {
          return null;
        }
        return {
          name: "repo",
          path: repoPath,
          worktrees,
        };
      },
      listWorktrees(dirPath: string) {
        if (path.resolve(dirPath) !== repoPath) {
          return [];
        }
        return worktrees;
      },
    },
  });

  try {
    const started = await fetchJson(`${harness.baseUrl}/workflow/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "Implement headless workflow control",
        repo: repoPath,
        worktree: repoPath,
        template: "single-step",
        allType: "codex",
      }),
    });

    assert.equal(started.status, 200);
    assert.equal(started.body.workflow.status, "running");
    assert.equal(harness.projectStore.getProjects().length, 1);
    assert.equal(harness.projectStore.getProjects()[0].path, repoPath);
    assert.equal(harness.ptyManager.creates.length, 1);
    assert.equal(harness.ptyManager.creates[0].cwd, repoPath);
    assert.equal(harness.ptyManager.creates[0].shell, "codex");

    const listed = await fetchJson(
      `${harness.baseUrl}/workflow/list?repo=${encodeURIComponent(repoPath)}`,
    );
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].id, started.body.workflow.id);

    const handoff = started.body.handoffs[0];
    fs.writeFileSync(
      handoff.artifacts.result_file,
      JSON.stringify({
        version: "hydra/v2",
        handoff_id: handoff.id,
        workflow_id: handoff.workflow_id,
        success: true,
        summary: "Completed workflow control implementation.",
        outputs: [
          {
            path: "headless-runtime/workflow-control.ts",
            description: "Workflow control implementation",
          },
        ],
        evidence: ["manual test"],
        next_action: { type: "complete", reason: "Workflow is complete." },
      }, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      handoff.artifacts.done_file,
      JSON.stringify({
        version: "hydra/v2",
        handoff_id: handoff.id,
        workflow_id: handoff.workflow_id,
        result_file: handoff.artifacts.result_file,
      }, null, 2),
      "utf-8",
    );

    const ticked = await fetchJson(
      `${harness.baseUrl}/workflow/${encodeURIComponent(started.body.workflow.id)}/tick`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoPath }),
      },
    );

    assert.equal(ticked.status, 200);
    assert.equal(ticked.body.workflow.status, "completed");
    assert.equal(harness.projectStore.listTerminals().length, 0);

    const cleaned = await fetchJson(
      `${harness.baseUrl}/workflow/${encodeURIComponent(started.body.workflow.id)}?repo=${encodeURIComponent(repoPath)}`,
      {
        method: "DELETE",
      },
    );
    assert.equal(cleaned.status, 200);
    assert.equal(
      fs.existsSync(path.join(repoPath, ".hydra", "workflows", started.body.workflow.id)),
      false,
    );
  } finally {
    await stopHeadlessServer(harness);
  }
});
