import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffManager } from "../src/handoff/manager.ts";
import { writeDoneMarker, writeResultContract } from "../src/collector.ts";
import { getWorkflowStatus, runWorkflow, tickWorkflow } from "../src/workflow.ts";

function createRepoFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-template-"));
  const worktreePath = path.join(repoPath, "worktree");
  fs.mkdirSync(worktreePath, { recursive: true });
  return {
    repoPath,
    worktreePath,
  };
}

test("planner -> implementer -> evaluator template advances through all three handoffs", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Build the three-step workflow template",
        repoPath,
        worktreePath,
        template: "planner-implementer-evaluator",
        agentType: "codex",
        evaluatorType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:00:00.000Z",
        dispatchCreateOnly: async (request) => {
          dispatchOrder.push(request.handoffId);
          return {
            projectId: "project-1",
            terminalId: `terminal-${dispatchOrder.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
      },
    );

    assert.equal(started.handoffs.length, 3);
    assert.equal(dispatchOrder.length, 1);
    assert.equal(started.handoffs[0].to.role, "planner");
    assert.equal(started.handoffs[1].to.role, "implementer");
    assert.equal(started.handoffs[2].to.role, "evaluator");

    const manager = new HandoffManager(repoPath);

    const planner = manager.load(started.handoffs[0].id)!;
    writeResultContract(
      { artifacts: planner.artifacts! },
      {
        version: "hydra/v2",
        handoff_id: planner.id,
        workflow_id: planner.workflow_id,
        success: true,
        summary: "Planner produced a concrete implementation plan.",
        outputs: [{ path: "plan.md", description: "Implementation plan" }],
        evidence: ["manual planning"],
        next_action: { type: "handoff", reason: "Implementation can start.", handoff_id: started.handoffs[1].id },
      },
    );
    writeDoneMarker({
      artifacts: planner.artifacts!,
      handoff_id: planner.id,
      workflow_id: planner.workflow_id,
    });

    const afterPlanner = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:00:10.000Z",
        dispatchCreateOnly: async (request) => {
          dispatchOrder.push(request.handoffId);
          return {
            projectId: "project-1",
            terminalId: `terminal-${dispatchOrder.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
      },
    );
    assert.equal(afterPlanner.workflow.current_handoff_id, started.handoffs[1].id);
    assert.equal(dispatchOrder.length, 2);

    const implementer = manager.load(started.handoffs[1].id)!;
    writeResultContract(
      { artifacts: implementer.artifacts! },
      {
        version: "hydra/v2",
        handoff_id: implementer.id,
        workflow_id: implementer.workflow_id,
        success: true,
        summary: "Implementer completed the requested change.",
        outputs: [{ path: "src/feature.ts", description: "Implementation" }],
        evidence: ["npm test"],
        next_action: { type: "handoff", reason: "Evaluation can start.", handoff_id: started.handoffs[2].id },
      },
    );
    writeDoneMarker({
      artifacts: implementer.artifacts!,
      handoff_id: implementer.id,
      workflow_id: implementer.workflow_id,
    });

    const afterImplementer = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:00:20.000Z",
        dispatchCreateOnly: async (request) => {
          dispatchOrder.push(request.handoffId);
          return {
            projectId: "project-1",
            terminalId: `terminal-${dispatchOrder.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
      },
    );
    assert.equal(afterImplementer.workflow.current_handoff_id, started.handoffs[2].id);
    assert.equal(dispatchOrder.length, 3);

    const evaluator = manager.load(started.handoffs[2].id)!;
    const evaluatorTask = fs.readFileSync(evaluator.artifacts!.task_file, "utf-8");
    assert.match(evaluatorTask, /vulnerabilities\/risks\/unmet standards/i);

    writeResultContract(
      { artifacts: evaluator.artifacts! },
      {
        version: "hydra/v2",
        handoff_id: evaluator.id,
        workflow_id: evaluator.workflow_id,
        success: true,
        summary: "Evaluator found no blocking issues.",
        outputs: [{ path: "report.md", description: "Evaluation report" }],
        evidence: ["npm test", "manual review"],
        next_action: { type: "complete", reason: "Workflow is complete." },
      },
    );
    writeDoneMarker({
      artifacts: evaluator.artifacts!,
      handoff_id: evaluator.id,
      workflow_id: evaluator.workflow_id,
    });

    const completed = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:00:30.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch once evaluation passed");
        },
      },
    );

    assert.equal(completed.workflow.status, "completed");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("runWorkflow honors explicit provider selection by role", async () => {
  const { repoPath, worktreePath } = createRepoFixture();

  try {
    const started = await runWorkflow(
      {
        task: "Mix providers by role",
        repoPath,
        worktreePath,
        template: "planner-implementer-evaluator",
        plannerType: "claude",
        implementerType: "codex",
        evaluatorType: "gemini",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:05:00.000Z",
        dispatchCreateOnly: async (request) => ({
          projectId: "project-1",
          terminalId: `terminal-${request.handoffId}`,
          terminalType: request.agentType,
          terminalTitle: request.agentType,
          prompt: `Read ${request.taskFile}`,
        }),
      },
    );

    assert.equal(started.workflow.agent_type, "codex");
    assert.equal(started.handoffs[0].from.agent_type, "claude");
    assert.equal(started.handoffs[0].to.agent_type, "claude");
    assert.equal(started.handoffs[1].from.agent_type, "claude");
    assert.equal(started.handoffs[1].to.agent_type, "codex");
    assert.equal(started.handoffs[2].from.agent_type, "codex");
    assert.equal(started.handoffs[2].to.agent_type, "gemini");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("evaluator failure loops back to the implementer handoff", async () => {
  const { repoPath, worktreePath } = createRepoFixture();

  try {
    const started = await runWorkflow(
      {
        task: "Build the evaluator loop",
        repoPath,
        worktreePath,
        template: "planner-implementer-evaluator",
        agentType: "codex",
        evaluatorType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:10:00.000Z",
        dispatchCreateOnly: async (request) => ({
          projectId: "project-1",
          terminalId: `terminal-${request.handoffId}`,
          terminalType: request.agentType,
          terminalTitle: request.agentType,
          prompt: `Read ${request.taskFile}`,
        }),
      },
    );

    const manager = new HandoffManager(repoPath);
    for (const handoffId of started.workflow.handoff_ids.slice(0, 2)) {
      const handoff = manager.load(handoffId)!;
      writeResultContract(
        { artifacts: handoff.artifacts! },
        {
          version: "hydra/v2",
          handoff_id: handoff.id,
          workflow_id: handoff.workflow_id,
          success: true,
          summary: `Completed ${handoff.to.role}.`,
          outputs: [{ path: `${handoff.to.role}.md`, description: `${handoff.to.role} output` }],
          evidence: ["manual"],
          next_action: { type: "handoff", reason: "Continue the workflow." },
        },
      );
      writeDoneMarker({
        artifacts: handoff.artifacts!,
        handoff_id: handoff.id,
        workflow_id: handoff.workflow_id,
      });
      await tickWorkflow(
        { repoPath, workflowId: started.workflow.id },
        {
          now: () => "2026-03-26T12:10:10.000Z",
          dispatchCreateOnly: async (request) => ({
            projectId: "project-1",
            terminalId: `terminal-${request.handoffId}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          }),
        },
      );
    }

    const evaluator = manager.load(started.handoffs[2].id)!;
    writeResultContract(
      { artifacts: evaluator.artifacts! },
      {
        version: "hydra/v2",
        handoff_id: evaluator.id,
        workflow_id: evaluator.workflow_id,
        success: false,
        summary: "Evaluator found an unmet standard in the implementation.",
        outputs: [{ path: "findings.md", description: "Blocking findings" }],
        evidence: ["manual review"],
        next_action: {
          type: "handoff",
          reason: "Implementer must address the blocked standard.",
          handoff_id: started.handoffs[1].id,
        },
      },
    );
    writeDoneMarker({
      artifacts: evaluator.artifacts!,
      handoff_id: evaluator.id,
      workflow_id: evaluator.workflow_id,
    });

    const looped = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:10:30.000Z",
        dispatchCreateOnly: async (request) => ({
          projectId: "project-1",
          terminalId: `terminal-loop-${request.handoffId}`,
          terminalType: request.agentType,
          terminalTitle: request.agentType,
          prompt: `Read ${request.taskFile}`,
        }),
      },
    );

    const status = getWorkflowStatus({
      repoPath,
      workflowId: started.workflow.id,
    });

    assert.equal(looped.workflow.status, "running");
    assert.equal(looped.workflow.current_handoff_id, started.handoffs[1].id);
    assert.equal(status.handoffs[1].status, "in_progress");
    assert.equal(status.handoffs[2].status, "pending");

    // The done marker must be removed to prevent phantom completion.
    // result.json is preserved so downstream agents can read it
    // (e.g. evaluator findings for the next implementer).
    const implHandoff = manager.load(started.handoffs[1].id)!;
    assert.ok(!fs.existsSync(implHandoff.artifacts!.done_file), "stale implementer done file should be removed");

    // A subsequent tick should see the handoff as still in-progress (waiting),
    // not immediately completed from stale files.
    const afterLoop = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:10:35.000Z",
        dispatchCreateOnly: async (request) => ({
          projectId: "project-1",
          terminalId: `terminal-post-loop-${request.handoffId}`,
          terminalType: request.agentType,
          terminalTitle: request.agentType,
          prompt: `Read ${request.taskFile}`,
        }),
      },
    );
    assert.equal(afterLoop.workflow.status, "running");
    assert.equal(afterLoop.workflow.current_handoff_id, started.handoffs[1].id);
    const implAfterLoop = afterLoop.handoffs.find((h) => h.id === started.handoffs[1].id)!;
    assert.equal(implAfterLoop.status, "in_progress");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("workflow dispatch persists the parent terminal id across later ticks", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const parentTerminalId = "terminal-parent";
  const previousParentTerminalId = process.env.TERMCANVAS_TERMINAL_ID;
  const seenParents: Array<string | undefined> = [];

  process.env.TERMCANVAS_TERMINAL_ID = parentTerminalId;

  try {
    const started = await runWorkflow(
      {
        task: "Keep workflow children linked to the invoking terminal",
        repoPath,
        worktreePath,
        template: "planner-implementer-evaluator",
        agentType: "codex",
        evaluatorType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:20:00.000Z",
        dispatchCreateOnly: async (request) => {
          seenParents.push(request.parentTerminalId);
          return {
            projectId: "project-1",
            terminalId: `terminal-${seenParents.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
      },
    );

    const manager = new HandoffManager(repoPath);
    const planner = manager.load(started.handoffs[0].id)!;
    writeResultContract(
      { artifacts: planner.artifacts! },
      {
        version: "hydra/v2",
        handoff_id: planner.id,
        workflow_id: planner.workflow_id,
        success: true,
        summary: "Planner produced a concrete implementation plan.",
        outputs: [{ path: "plan.md", description: "Implementation plan" }],
        evidence: ["manual planning"],
        next_action: {
          type: "handoff",
          reason: "Implementation can start.",
          handoff_id: started.handoffs[1].id,
        },
      },
    );
    writeDoneMarker({
      artifacts: planner.artifacts!,
      handoff_id: planner.id,
      workflow_id: planner.workflow_id,
    });

    delete process.env.TERMCANVAS_TERMINAL_ID;

    await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:20:10.000Z",
        dispatchCreateOnly: async (request) => {
          seenParents.push(request.parentTerminalId);
          return {
            projectId: "project-1",
            terminalId: `terminal-${seenParents.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
      },
    );

    assert.deepEqual(seenParents, [parentTerminalId, parentTerminalId]);
  } finally {
    if (previousParentTerminalId === undefined) {
      delete process.env.TERMCANVAS_TERMINAL_ID;
    } else {
      process.env.TERMCANVAS_TERMINAL_ID = previousParentTerminalId;
    }
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("tick retries when telemetry reports process exited past grace period", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatched: string[] = [];

  try {
    // Start workflow — dispatches planner
    const started = await runWorkflow(
      {
        task: "Test early exit detection via telemetry",
        repoPath,
        worktreePath,
        template: "single-step",
        agentType: "claude",
        timeoutMinutes: 30,
        maxRetries: 2,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T14:00:00.000Z",
        dispatchCreateOnly: async (request) => {
          dispatched.push(request.handoffId);
          return {
            projectId: "project-1",
            terminalId: `terminal-${dispatched.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
      },
    );
    assert.equal(dispatched.length, 1);

    // Tick within grace period — telemetry says dead but we should NOT retry yet
    const withinGrace = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        // Only 5 seconds after dispatch — within 15s grace period
        now: () => "2026-03-26T14:00:05.000Z",
        dispatchCreateOnly: async (request) => {
          dispatched.push(request.handoffId);
          return {
            projectId: "project-1",
            terminalId: `terminal-${dispatched.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
        checkTerminalAlive: () => false,
      },
    );
    assert.equal(withinGrace.workflow.status, "running");
    assert.equal(dispatched.length, 1, "should not dispatch during grace period");

    // Tick past grace period — telemetry says dead, should trigger retry
    const pastGrace = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        // 20 seconds after dispatch — past 15s grace period
        now: () => "2026-03-26T14:00:20.000Z",
        dispatchCreateOnly: async (request) => {
          dispatched.push(request.handoffId);
          return {
            projectId: "project-1",
            terminalId: `terminal-${dispatched.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
        checkTerminalAlive: () => false,
      },
    );
    assert.equal(pastGrace.workflow.status, "running");
    assert.equal(dispatched.length, 2, "should have retried after grace period");

    // Telemetry returns null (unavailable) — should NOT retry
    const unavailable = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T14:00:40.000Z",
        dispatchCreateOnly: async (request) => {
          dispatched.push(request.handoffId);
          return {
            projectId: "project-1",
            terminalId: `terminal-${dispatched.length}`,
            terminalType: request.agentType,
            terminalTitle: request.agentType,
            prompt: `Read ${request.taskFile}`,
          };
        },
        checkTerminalAlive: () => null,
      },
    );
    assert.equal(unavailable.workflow.status, "running");
    assert.equal(dispatched.length, 2, "should not retry when telemetry unavailable");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
