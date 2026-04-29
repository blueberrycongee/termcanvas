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
import { AssignmentManager } from "../hydra/src/assignment/manager.ts";
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

function withLeadTerminal<T>(terminalId: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env.TERMCANVAS_TERMINAL_ID;
  process.env.TERMCANVAS_TERMINAL_ID = terminalId;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete process.env.TERMCANVAS_TERMINAL_ID;
      } else {
        process.env.TERMCANVAS_TERMINAL_ID = previous;
      }
    });
}

function writeSlimResult(
  resultFile: string,
  payload: {
    workflowId: string;
    assignmentId: string;
    runId: string;
    summary: string;
    outcome?: "completed" | "stuck" | "error";
  },
): string {
  const reportFile = path.join(path.dirname(resultFile), "report.md");
  fs.writeFileSync(
    reportFile,
    [
      "# Run Report",
      "",
      "## Summary",
      "",
      payload.summary,
      "",
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(
    resultFile,
    JSON.stringify(
      {
        schema_version: "hydra/result/v0.1",
        workbench_id: payload.workflowId,
        assignment_id: payload.assignmentId,
        run_id: payload.runId,
        outcome: payload.outcome ?? "completed",
        report_file: reportFile,
      },
      null,
      2,
    ),
    "utf-8",
  );
  return reportFile;
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

test("createWorkflowControl drives a Lead-driven workflow end-to-end (in-process)", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const worktrees = [{ path: repoPath, branch: "main", isPrimary: true }];
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
        if (path.resolve(dirPath) !== repoPath) return null;
        return { name: "repo", path: repoPath, worktrees };
      },
      listWorktrees(dirPath: string) {
        if (path.resolve(dirPath) !== repoPath) return [];
        return worktrees;
      },
    },
    eventBus,
  });

  try {
    await withLeadTerminal("terminal-lead-inproc", async () => {
      const init = await workflowControl.init({
        intent: "Implement headless workflow control",
        repoPath,
        worktreePath: repoPath,
        defaultAgentType: "codex",
      });
      assert.ok(init.workflow_id);

      const dispatch = await workflowControl.dispatch({
        repoPath,
        workflowId: init.workflow_id,
        nodeId: "dev",
        role: "reviewer",
        intent: "Implement workflow control",
      });
      assert.equal(dispatch.status, "dispatched");
      assert.equal(ptyManager.creates.length, 1);
      assert.equal(ptyManager.creates[0].shell, "codex");

      const manager = new AssignmentManager(repoPath, init.workflow_id);
      const assignment = manager.load(dispatch.assignment_id);
      assert.ok(assignment);
      const run = assignment.runs[assignment.runs.length - 1];
      assert.ok(run);
      writeSlimResult(run.result_file, {
        workflowId: init.workflow_id,
        assignmentId: assignment.id,
        runId: run.id,
        summary: "Completed workflow control implementation.",
      });

      const decision = await workflowControl.watchDecision(repoPath, init.workflow_id);
      assert.equal(decision.type, "node_completed");
      assert.equal(decision.completed?.outcome, "completed");
      assert.equal(decision.completed?.node_id, "dev");

      await workflowControl.approveNode(repoPath, init.workflow_id, "dev");
      await workflowControl.complete(repoPath, init.workflow_id, "All done.");

      const final = workflowControl.status(repoPath, init.workflow_id);
      assert.equal(final.workflow.status, "completed");
    });
  } finally {
    telemetryService.dispose();
  }
});

test("Lead-driven workflow HTTP routes init, dispatch, watch, approve, complete, and clean up", async () => {
  const workspaceDir = createWorkspaceFixture({});
  const repoPath = path.join(workspaceDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });
  initRepo(repoPath);

  const worktrees = [{ path: repoPath, branch: "main", isPrimary: true }];

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

  try {
    await withLeadTerminal("terminal-lead-http", async () => {
      const init = await fetchJson(`${harness.baseUrl}/workflow/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "Implement headless workflow control",
          repoPath,
          worktreePath: repoPath,
          defaultAgentType: "codex",
        }),
      });
      assert.equal(init.status, 200);
      assert.ok(init.body.workflow_id);
      const workflowId = init.body.workflow_id;

      const dispatch = await fetchJson(
        `${harness.baseUrl}/workflow/${encodeURIComponent(workflowId)}/dispatch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoPath,
            nodeId: "dev",
            role: "reviewer",
            intent: "Implement workflow control",
          }),
        },
      );
      assert.equal(dispatch.status, 200);
      assert.equal(dispatch.body.status, "dispatched");
      assert.equal(harness.ptyManager.creates.length, 1);
      assert.equal(harness.ptyManager.creates[0].shell, "codex");

      const listed = await fetchJson(
        `${harness.baseUrl}/workflow/list?repo=${encodeURIComponent(repoPath)}`,
      );
      assert.equal(listed.status, 200);
      assert.equal(listed.body.length, 1);
      assert.equal(listed.body[0].id, workflowId);

      const manager = new AssignmentManager(repoPath, workflowId);
      const assignment = manager.load(dispatch.body.assignment_id);
      assert.ok(assignment);
      const run = assignment.runs[assignment.runs.length - 1];
      assert.ok(run);
      writeSlimResult(run.result_file, {
        workflowId,
        assignmentId: assignment.id,
        runId: run.id,
        summary: "Completed workflow control implementation.",
      });

      const watched = await fetchJson(
        `${harness.baseUrl}/workflow/${encodeURIComponent(workflowId)}/watch-decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath }),
        },
      );
      assert.equal(watched.status, 200);
      assert.equal(watched.body.type, "node_completed");
      assert.equal(watched.body.completed?.outcome, "completed");

      const approved = await fetchJson(
        `${harness.baseUrl}/workflow/${encodeURIComponent(workflowId)}/node/dev/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath }),
        },
      );
      assert.equal(approved.status, 200);

      const completed = await fetchJson(
        `${harness.baseUrl}/workflow/${encodeURIComponent(workflowId)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoPath, summary: "All done." }),
        },
      );
      assert.equal(completed.status, 200);

      const cleaned = await fetchJson(
        `${harness.baseUrl}/workflow/${encodeURIComponent(workflowId)}?repo=${encodeURIComponent(repoPath)}`,
        { method: "DELETE" },
      );
      assert.equal(cleaned.status, 200);
      assert.equal(
        fs.existsSync(path.join(repoPath, ".hydra", "workbenches", workflowId)),
        false,
      );
    });
  } finally {
    await stopHeadlessServer(harness);
  }
});
