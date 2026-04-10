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

test("termcanvas workflow CLI drives a Lead-driven workflow init→dispatch→watch→approve→complete→cleanup", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const worktrees = [{ path: repoPath, branch: "main", isMain: true }];

  const harness = await startHeadlessServer({
    workspaceDir,
    projectScanner: {
      scan(dirPath: string) {
        if (path.resolve(dirPath) !== repoPath) return null;
        return { name: "repo", path: repoPath, worktrees };
      },
      listWorktrees(dirPath: string) {
        if (path.resolve(dirPath) !== repoPath) return [];
        return worktrees;
      },
    },
  });

  const cliEnv = { TERMCANVAS_URL: harness.baseUrl };

  // Lead identity is read from process.env.TERMCANVAS_TERMINAL_ID inside the
  // headless server (which runs in this test process), not the CLI subprocess.
  const previousLead = process.env.TERMCANVAS_TERMINAL_ID;
  process.env.TERMCANVAS_TERMINAL_ID = "terminal-cli-test-lead";

  try {
    const init = JSON.parse(
      await runCli([
        "workflow", "init",
        "--intent", "Implement headless workflow control",
        "--repo", repoPath,
        "--worktree", repoPath,
        "--agent-type", "codex",
        "--json",
      ], cliEnv),
    );
    assert.ok(init.workflow_id);
    const workflowId = init.workflow_id;

    const listed = JSON.parse(
      await runCli(["workflow", "list", "--repo", repoPath, "--json"], cliEnv),
    );
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, workflowId);

    const dispatch = JSON.parse(
      await runCli([
        "workflow", "dispatch", workflowId,
        "--node", "dev",
        "--role", "implementer",
        "--intent", "Implement workflow control",
        "--repo", repoPath,
        "--json",
      ], cliEnv),
    );
    assert.equal(dispatch.status, "dispatched");
    assert.equal(dispatch.node_id, "dev");
    assert.equal(harness.ptyManager.creates.length, 1);
    assert.equal(harness.ptyManager.creates[0].shell, "codex");

    // Look up the run's result_file via status, then write a slim result + report
    const status = JSON.parse(
      await runCli([
        "workflow", "status", workflowId, "--repo", repoPath, "--json",
      ], cliEnv),
    );
    assert.equal(status.workflow.status, "active");
    assert.equal(status.assignments.length, 1);
    const assignment = status.assignments[0];
    const run = assignment.runs[assignment.runs.length - 1];
    assert.ok(run);

    const reportFile = path.join(path.dirname(run.result_file), "report.md");
    fs.writeFileSync(reportFile, "# Run Report\n\n## Summary\n\nDone.\n", "utf-8");
    fs.writeFileSync(
      run.result_file,
      JSON.stringify(
        {
          schema_version: "hydra/result/v0.1",
          workflow_id: workflowId,
          assignment_id: assignment.id,
          run_id: run.id,
          outcome: "completed",
          report_file: reportFile,
        },
        null,
        2,
      ),
      "utf-8",
    );

    const watched = JSON.parse(
      await runCli([
        "workflow", "watch", workflowId, "--repo", repoPath, "--json",
      ], cliEnv),
    );
    assert.equal(watched.type, "node_completed");
    assert.equal(watched.completed?.node_id, "dev");
    assert.equal(watched.completed?.outcome, "completed");

    await runCli([
      "workflow", "approve", workflowId, "--node", "dev", "--repo", repoPath, "--json",
    ], cliEnv);

    await runCli([
      "workflow", "complete", workflowId, "--repo", repoPath, "--summary", "All done.", "--json",
    ], cliEnv);

    const finalStatus = JSON.parse(
      await runCli([
        "workflow", "status", workflowId, "--repo", repoPath, "--json",
      ], cliEnv),
    );
    assert.equal(finalStatus.workflow.status, "completed");

    const cleaned = JSON.parse(
      await runCli([
        "workflow", "cleanup", workflowId, "--repo", repoPath, "--json",
      ], cliEnv),
    );
    assert.equal(cleaned.ok, true);
    assert.equal(
      fs.existsSync(path.join(repoPath, ".hydra", "workflows", workflowId)),
      false,
    );
  } finally {
    if (previousLead === undefined) {
      delete process.env.TERMCANVAS_TERMINAL_ID;
    } else {
      process.env.TERMCANVAS_TERMINAL_ID = previousLead;
    }
    await stopHeadlessServer(harness);
  }
});

test("termcanvas workflow reset CLI sends a reset feedback to the headless server", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const worktrees = [{ path: repoPath, branch: "main", isMain: true }];

  const harness = await startHeadlessServer({
    workspaceDir,
    projectScanner: {
      scan(dirPath: string) {
        if (path.resolve(dirPath) !== repoPath) return null;
        return { name: "repo", path: repoPath, worktrees };
      },
      listWorktrees(dirPath: string) {
        if (path.resolve(dirPath) !== repoPath) return [];
        return worktrees;
      },
    },
  });

  const cliEnv = { TERMCANVAS_URL: harness.baseUrl };
  const previousLead = process.env.TERMCANVAS_TERMINAL_ID;
  process.env.TERMCANVAS_TERMINAL_ID = "terminal-cli-reset-test";

  try {
    const init = JSON.parse(
      await runCli([
        "workflow", "init",
        "--intent", "Reset CLI smoke",
        "--repo", repoPath,
        "--worktree", repoPath,
        "--agent-type", "codex",
        "--json",
      ], cliEnv),
    );
    const workflowId = init.workflow_id;

    await runCli([
      "workflow", "dispatch", workflowId,
      "--node", "dev",
      "--role", "implementer",
      "--intent", "First pass",
      "--repo", repoPath,
      "--json",
    ], cliEnv);

    const reset = JSON.parse(
      await runCli([
        "workflow", "reset", workflowId,
        "--node", "dev",
        "--feedback", "Try again with extra care.",
        "--repo", repoPath,
        "--json",
      ], cliEnv),
    );
    assert.ok(Array.isArray(reset.reset_node_ids));
    assert.ok(reset.reset_node_ids.includes("dev"));

    // Verify the feedback file was actually written by the server
    const feedbackPath = path.join(
      repoPath, ".hydra", "workflows", workflowId, "nodes", "dev", "feedback.md",
    );
    assert.ok(fs.existsSync(feedbackPath));
    assert.match(fs.readFileSync(feedbackPath, "utf-8"), /Try again with extra care/);

    await runCli([
      "workflow", "cleanup", workflowId, "--repo", repoPath, "--force", "--json",
    ], cliEnv);
  } finally {
    if (previousLead === undefined) {
      delete process.env.TERMCANVAS_TERMINAL_ID;
    } else {
      process.env.TERMCANVAS_TERMINAL_ID = previousLead;
    }
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
