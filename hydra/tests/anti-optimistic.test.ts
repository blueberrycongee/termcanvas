import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffManager } from "../src/handoff/manager.ts";
import { writeDoneMarker } from "../src/collector.ts";
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

test("duplicate tick calls do not dispatch the same handoff twice", async () => {
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
        evaluatorType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T13:00:00.000Z",
        dispatchCreateOnly: async (request) => {
          dispatchCalls.push(request.handoffId);
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
          throw new Error("must not redispatch while handoff is still in progress");
        },
      },
    );
    const secondTick = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T13:00:20.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch while handoff is still in progress");
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
        evaluatorType: "claude",
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

    const manager = new HandoffManager(repoPath);
    const handoff = manager.load(started.workflow.current_handoff_id)!;
    fs.writeFileSync(handoff.artifacts!.result_file, "{\"version\":\"hydra/v2\"", "utf-8");
    writeDoneMarker({
      artifacts: handoff.artifacts!,
      handoff_id: handoff.id,
      workflow_id: handoff.workflow_id,
    });

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

test("workflow tick triggers timeout retry on the real orchestration path", async () => {
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
        evaluatorType: "claude",
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

    const manager = new HandoffManager(repoPath);
    const handoff = manager.load(started.workflow.current_handoff_id)!;

    assert.equal(retried.workflow.status, "running");
    assert.deepEqual(terminalIds, ["terminal-1", "terminal-2"]);
    assert.equal(handoff.dispatch?.attempts.length, 2);
    assert.equal(handoff.dispatch?.attempts[1].retry_of, "terminal-1");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
