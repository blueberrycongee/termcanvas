import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssignmentManager } from "../src/assignment/manager.ts";
import { runWorkflow, tickWorkflow } from "../src/workflow.ts";

function createRepoFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-anti-optimistic-"));
  const worktreePath = path.join(repoPath, "worktree");
  fs.mkdirSync(worktreePath, { recursive: true });
  return {
    repoPath,
    worktreePath,
  };
}

test("duplicate tick calls do not dispatch the same assignment twice", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchCalls: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Guard against duplicate dispatch",
        repoPath,
        worktreePath,
        template: "single-step",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T13:00:00.000Z",
        dispatchCreateOnly: async (request) => {
          dispatchCalls.push(request.assignmentId ?? "<unknown>");
          return {
            projectId: "project-1",
            terminalId: `terminal-${dispatchCalls.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
      },
    );

    const firstTick = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T13:00:10.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch while assignment is still in progress");
        },
      },
    );
    const secondTick = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T13:00:20.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch while assignment is still in progress");
        },
      },
    );

    assert.equal(dispatchCalls.length, 1);
    assert.equal(firstTick.workflow.status, "running");
    assert.equal(secondTick.workflow.status, "running");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("half-written result.json fails the workflow instead of optimistic success", async () => {
  const { repoPath, worktreePath } = createRepoFixture();

  try {
    const started = await runWorkflow(
      {
        task: "Reject half-written result files",
        repoPath,
        worktreePath,
        template: "single-step",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T13:10:00.000Z",
        dispatchCreateOnly: async (request) => ({
          projectId: "project-1",
          terminalId: "terminal-1",
          terminalType: request.agentType,
          terminalTitle: request.agentType,
          prompt: `Read ${request.taskFile}`,
        }),
      },
    );

    const manager = new AssignmentManager(repoPath, started.workflow.id);
    const assignment = manager.load(started.workflow.current_assignment_id);
    assert.ok(assignment);
    const activeRun = assignment.runs.find((run) => run.id === assignment.active_run_id);
    assert.ok(activeRun);
    fs.writeFileSync(activeRun.result_file, "{\"schema_version\":\"hydra/result/v1\"", "utf-8");

    const failed = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T13:10:10.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not dispatch after collector failure");
        },
      },
    );

    assert.equal(failed.workflow.status, "failed");
    assert.equal(failed.workflow.failure?.code, "COLLECTOR_RESULT_INVALID");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("dispatch failure does not leave a claimed assignment without a run", async () => {
  const { repoPath, worktreePath } = createRepoFixture();

  try {
    const failed = await runWorkflow(
      {
        task: "Fail cleanly during initial dispatch",
        repoPath,
        worktreePath,
        template: "single-step",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T13:15:00.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("dispatch exploded");
        },
      },
    );

    const manager = new AssignmentManager(repoPath, failed.workflow.id);
    const assignment = manager.load(failed.workflow.current_assignment_id);
    assert.ok(assignment);

    assert.equal(failed.workflow.status, "failed");
    assert.equal(failed.workflow.failure?.code, "ASSIGNMENT_DISPATCH_FAILED");
    assert.equal(assignment.status, "failed");
    assert.equal(assignment.runs.length, 0);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("workflow tick retries timeouts with a fresh run and terminal", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const terminalIds: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Retry timed out workflows",
        repoPath,
        worktreePath,
        template: "single-step",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 1,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T13:20:00.000Z",
        dispatchCreateOnly: async (request) => {
          const terminalId = `terminal-${terminalIds.length + 1}`;
          terminalIds.push(terminalId);
          return {
            projectId: "project-1",
            terminalId,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
      },
    );

    const retried = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T13:21:10.000Z",
        dispatchCreateOnly: async (request) => {
          const terminalId = `terminal-${terminalIds.length + 1}`;
          terminalIds.push(terminalId);
          return {
            projectId: "project-1",
            terminalId,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
      },
    );

    const manager = new AssignmentManager(repoPath, started.workflow.id);
    const assignment = manager.load(started.workflow.current_assignment_id);
    assert.ok(assignment);

    assert.equal(retried.workflow.status, "running");
    assert.deepEqual(terminalIds, ["terminal-1", "terminal-2"]);
    assert.equal(assignment.runs.length, 2);
    assert.equal(assignment.runs[1]?.retry_of_run_id, assignment.runs[0]?.id);
    assert.notEqual(assignment.runs[0]?.id, assignment.runs[1]?.id);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
