import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssignmentManager } from "../src/assignment/manager.ts";
import {
  getWorkflowStatus,
  runWorkflow,
  tickWorkflow,
  watchWorkflow,
} from "../src/workflow.ts";
import { WORKFLOW_RESULT_SCHEMA_VERSION } from "../src/protocol.ts";
import { parseChallengeArgs } from "../src/challenge-command.ts";
import { parseResolveChallengeArgs } from "../src/resolve-challenge.ts";
import { parseRunArgs } from "../src/run.ts";
import { parseWatchArgs } from "../src/watch.ts";

function createRepoFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-workflow-"));
  const worktreePath = path.join(repoPath, "worktree");
  fs.mkdirSync(worktreePath, { recursive: true });
  return {
    repoPath,
    worktreePath,
  };
}

test("parseRunArgs, parseWatchArgs, and challenge commands read orchestration CLI flags", () => {
  assert.deepEqual(
    parseRunArgs([
      "--task", "Implement the workflow",
      "--repo", "/repo/project",
      "--worktree", "/repo/project/.worktrees/hydra-1",
      "--researcher-type", "claude",
      "--implementer-type", "codex",
      "--tester-type", "gemini",
      "--timeout-minutes", "15",
      "--max-retries", "2",
    ]),
    {
      task: "Implement the workflow",
      repo: "/repo/project",
      worktree: "/repo/project/.worktrees/hydra-1",
      template: "researcher-implementer-tester",
      researcherType: "claude",
      implementerType: "codex",
      testerType: "gemini",
      timeoutMinutes: 15,
      maxRetries: 2,
      autoApprove: true,
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

  assert.deepEqual(
    parseChallengeArgs([
      "--repo", "/repo/project",
      "--workflow", "workflow-123",
    ]),
    {
      repo: "/repo/project",
      workflow: "workflow-123",
    },
  );

  assert.deepEqual(
    parseResolveChallengeArgs([
      "--repo", "/repo/project",
      "--workflow", "workflow-123",
      "--decision", "send_back",
      "--to", "implementer",
    ]),
    {
      repo: "/repo/project",
      workflow: "workflow-123",
      decision: "send_back",
      to: "implementer",
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
        template: "single-step",
        agentType: "codex",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: true,
      },
      {
        now: () => "2026-03-26T12:00:00.000Z",
        dispatchCreateOnly: async (request) => {
          dispatchCalls.push(request.assignmentId ?? "<unknown>");
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
    assert.equal(started.assignments.length, 1);
    assert.equal(started.assignments[0]?.status, "in_progress");

    const manager = new AssignmentManager(repoPath, started.workflow.id);
    const activeAssignment = manager.load(started.workflow.current_assignment_id);
    assert.ok(activeAssignment);
    const activeRun = activeAssignment.runs.find((run) => run.id === activeAssignment.active_run_id);
    assert.ok(activeRun);

    fs.writeFileSync(
      activeRun.result_file,
      JSON.stringify({
        schema_version: WORKFLOW_RESULT_SCHEMA_VERSION,
        workflow_id: started.workflow.id,
        assignment_id: activeAssignment.id,
        run_id: activeRun.id,
        success: true,
        summary: "Workflow completed successfully.",
        outputs: [{ path: "hydra/src/workflow.ts", description: "Workflow CLI orchestration" }],
        evidence: ["npm test"],
        next_action: { type: "complete", reason: "Workflow is done." },
      }),
      "utf-8",
    );

    const ticked = await tickWorkflow(
      {
        repoPath,
        workflowId: started.workflow.id,
      },
      {
        now: () => "2026-03-26T12:00:10.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch a completed assignment");
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
    assert.equal(status.assignments[0]?.result?.success, true);

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
          throw new Error("must not redispatch a completed assignment");
        },
        sleep: async () => {},
      },
    );

    assert.equal(watched.workflow.status, "completed");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
