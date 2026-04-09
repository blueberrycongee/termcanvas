import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ProjectScanner } from "../electron/project-scanner.ts";
import {
  createWorkspaceFixture,
  startHeadlessServer,
  stopHeadlessServer,
} from "./headless-runtime-test-helpers.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

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

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "cli/termcanvas.ts", ...args],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return stdout.trim();
}

test("termcanvas CLI preserves TERMCANVAS_URL path prefixes for remote routing", async () => {
  const seenPaths: string[] = [];
  const server = http.createServer((req, res) => {
    seenPaths.push(req.url ?? "");
    if (req.url === "/termcanvas/project/list") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const output = await runCli(
      ["project", "list", "--json"],
      { TERMCANVAS_URL: `http://127.0.0.1:${port}/termcanvas` },
    );

    assert.equal(output, "[]");
    assert.deepEqual(seenPaths, ["/termcanvas/project/list"]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
});

test("termcanvas workflow CLI runs, watches, and cleans up headless workflows", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const worktrees = [{ path: repoPath, branch: "main", isMain: true }];

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

  const cliEnv = { TERMCANVAS_URL: harness.baseUrl };

  try {
    const started = JSON.parse(
      await runCli([
        "workflow",
        "run",
        "--task",
        "Implement headless workflow control",
        "--repo",
        repoPath,
        "--worktree",
        repoPath,
        "--template",
        "single-step",
        "--all-type",
        "codex",
        "--json",
      ], cliEnv),
    );

    assert.equal(started.workflow.status, "running");
    assert.equal(started.workflow.worktree_path, repoPath);
    assert.equal(harness.ptyManager.creates.length, 1);
    assert.equal(harness.ptyManager.creates[0].shell, "codex");

    const listed = JSON.parse(
      await runCli(["workflow", "list", "--repo", repoPath, "--json"], cliEnv),
    );
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, started.workflow.id);

    const status = JSON.parse(
      await runCli([
        "workflow",
        "status",
        started.workflow.id,
        "--repo",
        repoPath,
        "--json",
      ], cliEnv),
    );
    assert.equal(status.workflow.status, "running");
    assert.equal(status.workflow.id, started.workflow.id);

    const assignment = started.assignments[0];
    const run = assignment.runs[0];
    fs.writeFileSync(
      run.result_file,
      JSON.stringify({
        schema_version: "hydra/result/v2",
        assignment_id: assignment.id,
        workflow_id: started.workflow.id,
        run_id: run.id,
        summary: "Completed workflow control implementation.",
        outputs: [
          {
            path: "headless-runtime/workflow-control.ts",
            description: "Workflow control implementation",
          },
        ],
        evidence: ["cli workflow test"],
        outcome: "completed",
      }, null, 2),
      "utf-8",
    );

    const watched = JSON.parse(
      await runCli([
        "workflow",
        "watch",
        started.workflow.id,
        "--repo",
        repoPath,
        "--interval-ms",
        "1",
        "--timeout-ms",
        "10000",
        "--json",
      ], cliEnv),
    );
    assert.equal(watched.workflow.status, "completed");
    assert.equal(harness.projectStore.listTerminals().length, 0);

    const cleaned = JSON.parse(
      await runCli([
        "workflow",
        "cleanup",
        started.workflow.id,
        "--repo",
        repoPath,
        "--json",
      ], cliEnv),
    );
    assert.equal(cleaned.ok, true);
    assert.equal(
      fs.existsSync(path.join(repoPath, ".hydra", "workflows", started.workflow.id)),
      false,
    );
  } finally {
    await stopHeadlessServer(harness);
  }
});

test("termcanvas worktree CLI creates, lists, and removes headless worktrees", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const harness = await startHeadlessServer({
    workspaceDir,
    projectScanner: new ProjectScanner(),
  });

  const cliEnv = { TERMCANVAS_URL: harness.baseUrl };

  try {
    const created = JSON.parse(
      await runCli([
        "worktree",
        "create",
        "--repo",
        repoPath,
        "--branch",
        "feature/cloud-cli",
        "--json",
      ], cliEnv),
    );
    assert.equal(created.branch, "feature/cloud-cli");
    assert.equal(fs.existsSync(created.path), true);

    const listed = JSON.parse(
      await runCli(["worktree", "list", "--repo", repoPath, "--json"], cliEnv),
    );
    assert.equal(listed.length, 2);
    assert.equal(
      listed.some((worktree: { branch: string }) => worktree.branch === "feature/cloud-cli"),
      true,
    );

    const removed = JSON.parse(
      await runCli([
        "worktree",
        "remove",
        "--repo",
        repoPath,
        "--path",
        created.path,
        "--force",
        "--json",
      ], cliEnv),
    );
    assert.equal(removed.ok, true);
    assert.equal(fs.existsSync(created.path), false);
  } finally {
    await stopHeadlessServer(harness);
  }
});
