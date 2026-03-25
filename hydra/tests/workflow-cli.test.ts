import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffManager } from "../src/handoff/manager.ts";
import {
  getWorkflowStatus,
  runWorkflow,
  tickWorkflow,
  watchWorkflow,
} from "../src/workflow.ts";
import { parseRunArgs } from "../src/run.ts";
import { parseWatchArgs } from "../src/watch.ts";
import { writeDoneMarker, writeResultContract } from "../src/collector.ts";

function createRepoFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-workflow-"));
  const worktreePath = path.join(repoPath, "worktree");
  fs.mkdirSync(worktreePath, { recursive: true });
  return {
    repoPath,
    worktreePath,
  };
}

test("parseRunArgs and parseWatchArgs read the orchestration CLI flags", () => {
  assert.deepEqual(
    parseRunArgs([
      "--task", "Implement the workflow",
      "--repo", "/repo/project",
      "--worktree", "/repo/project/.worktrees/hydra-1",
      "--type", "codex",
      "--timeout-minutes", "15",
      "--max-retries", "2",
    ]),
    {
      task: "Implement the workflow",
      repo: "/repo/project",
      worktree: "/repo/project/.worktrees/hydra-1",
      type: "codex",
      timeoutMinutes: 15,
      maxRetries: 2,
      autoApprove: false,
    },
  );

  assert.deepEqual(
    parseWatchArgs([
      "--repo", "/repo/project",
      "--workflow", "workflow-123",
      "--interval-ms", "250",
      "--timeout-ms", "2000",
    ]),
    {
      repo: "/repo/project",
      workflow: "workflow-123",
      intervalMs: 250,
      timeoutMs: 2000,
    },
  );
});

test("runWorkflow, tickWorkflow, status, and watch orchestrate a single-step workflow", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchCalls: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Implement the workflow control plane",
        repoPath,
        worktreePath,
        agentType: "codex",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: true,
      },
      {
        now: () => "2026-03-26T12:00:00.000Z",
        dispatchCreateOnly: async (request) => {
          dispatchCalls.push(request.handoffId);
          return {
            projectId: "project-1",
            terminalId: "terminal-1",
            terminalType: "codex",
            terminalTitle: "Codex",
            prompt: `Read ${request.taskFile}`,
          };
        },
        sleep: async () => {},
      },
    );

    assert.equal(started.workflow.status, "running");
    assert.equal(dispatchCalls.length, 1);
    assert.equal(started.handoffs.length, 1);
    assert.equal(started.handoffs[0].status, "in_progress");

    const manager = new HandoffManager(repoPath);
    const activeHandoff = manager.load(started.workflow.current_handoff_id)!;
    assert.ok(activeHandoff.artifacts, "expected task package artifacts");

    writeResultContract(
      {
        artifacts: activeHandoff.artifacts!,
      },
      {
        version: "hydra/v2",
        handoff_id: activeHandoff.id,
        workflow_id: activeHandoff.workflow_id,
        success: true,
        summary: "Workflow completed successfully.",
        outputs: [{ path: "hydra/src/workflow.ts", description: "Workflow CLI orchestration" }],
        evidence: ["npm test"],
        next_action: { type: "complete", reason: "Workflow is done." },
      },
    );
    writeDoneMarker({
      artifacts: activeHandoff.artifacts!,
      handoff_id: activeHandoff.id,
      workflow_id: activeHandoff.workflow_id,
    });

    const ticked = await tickWorkflow(
      {
        repoPath,
        workflowId: started.workflow.id,
      },
      {
        now: () => "2026-03-26T12:00:10.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch a completed handoff");
        },
      },
    );

    assert.equal(ticked.workflow.status, "completed");
    assert.equal(ticked.workflow.result?.summary, "Workflow completed successfully.");

    const status = getWorkflowStatus({
      repoPath,
      workflowId: started.workflow.id,
    });
    assert.equal(status.workflow.status, "completed");
    assert.equal(status.handoffs[0].result?.success, true);

    const watched = await watchWorkflow(
      {
        repoPath,
        workflowId: started.workflow.id,
        intervalMs: 1,
        timeoutMs: 10,
      },
      {
        now: () => "2026-03-26T12:00:11.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch a completed handoff");
        },
        sleep: async () => {},
      },
    );

    assert.equal(watched.workflow.status, "completed");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
