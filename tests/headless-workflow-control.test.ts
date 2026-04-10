import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TelemetryService } from "../electron/telemetry-service.ts";
import { ServerEventBus } from "../headless-runtime/event-bus.ts";
import { launchTrackedTerminal } from "../headless-runtime/terminal-launch.ts";
import { ProjectStore } from "../headless-runtime/project-store.ts";
import { createWorkflowControl } from "../headless-runtime/workflow-control.ts";
import {
  FakePtyManager,
  addProjectWithMainWorktree,
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

test("workflow-linked terminal exits do not emit workflow completion before the Hydra contract exists", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const projectStore = new ProjectStore();
  addProjectWithMainWorktree(projectStore, workspaceDir, "workflow-events");
  const ptyManager = new FakePtyManager();
  const telemetryService = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const eventBus = new ServerEventBus();

  try {
    await launchTrackedTerminal({
      projectStore,
      ptyManager,
      telemetryService,
      eventBus,
      worktree: workspaceDir,
      type: "codex",
      workflowId: "workflow-test",
      assignmentId: "assignment-test",
      repoPath: workspaceDir,
    });

    ptyManager.emitExit(1, 0);

    assert.equal(
      eventBus.getRecentEvents(10).some((event) => event.type === "workflow_completed"),
      false,
    );
  } finally {
    telemetryService.dispose();
  }
});

test("workflow control emits workflow_completed only after Hydra marks the workflow complete", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const worktrees = [
    { path: repoPath, branch: "main", isMain: true },
  ];
  const projectStore = new ProjectStore();
  const ptyManager = new FakePtyManager();
  const telemetryService = new TelemetryService({
    processPollIntervalMs: 0,
    sessionPollIntervalMs: 0,
  });
  const eventBus = new ServerEventBus();
  (ptyManager as { destroy: (ptyId: number) => void }).destroy = () => {};

  const workflowControl = createWorkflowControl({
    projectStore,
    ptyManager,
    telemetryService,
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
    eventBus,
  });

  try {
    const started = await workflowControl.run({
      task: "Implement headless workflow control",
      repoPath,
      worktreePath: repoPath,
      template: "single-step",
      allType: "codex",
    });

    assert.equal(
      eventBus.getRecentEvents(10).some((event) => event.type === "workflow_started"),
      true,
    );
    assert.equal(
      eventBus.getRecentEvents(10).some((event) => event.type === "workflow_completed"),
      false,
    );

    const assignment = started.assignments[0];
    const run = assignment.runs[0];
    fs.writeFileSync(
      run.result_file,
      JSON.stringify({
        schema_version: "hydra/result/v0.1",
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
        evidence: ["workflow event test"],
        outcome: "completed",
      }, null, 2),
      "utf-8",
    );

    const ticked = await workflowControl.tick(repoPath, started.workflow.id);

    assert.equal(ticked.workflow.status, "completed");
    assert.equal(
      eventBus.getRecentEvents(10).some((event) => event.type === "workflow_completed"),
      true,
    );
  } finally {
    telemetryService.dispose();
  }
});

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

    const assignment = started.body.assignments[0];
    const run = assignment.runs[0];
    fs.writeFileSync(
      run.result_file,
      JSON.stringify({
        schema_version: "hydra/result/v0.1",
        assignment_id: assignment.id,
        workflow_id: started.body.workflow.id,
        run_id: run.id,
        summary: "Completed workflow control implementation.",
        outputs: [
          {
            path: "headless-runtime/workflow-control.ts",
            description: "Workflow control implementation",
          },
        ],
        evidence: ["manual test"],
        outcome: "completed",
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
