import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffManager } from "../src/handoff/manager.ts";
import type { Handoff } from "../src/handoff/types.ts";
import { writeDoneMarker, writeResultContract } from "../src/collector.ts";
import { getWorkflowStatus, runWorkflow, tickWorkflow } from "../src/workflow.ts";
import { loadWorkflow, saveWorkflow } from "../src/workflow-store.ts";

function createRepoFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-template-"));
  const worktreePath = path.join(repoPath, "worktree");
  fs.mkdirSync(worktreePath, { recursive: true });
  return {
    repoPath,
    worktreePath,
  };
}

function createDispatchCreateOnly(dispatchOrder: string[]) {
  return async (request: { handoffId: string; agentType: string; taskFile: string }) => {
    dispatchOrder.push(request.handoffId);
    return {
      projectId: "project-1",
      terminalId: `terminal-${dispatchOrder.length}`,
      terminalType: request.agentType,
      terminalTitle: request.agentType,
      prompt: `Read ${request.taskFile}`,
    };
  };
}

function writeHandoffResult(
  handoff: Handoff,
  result: {
    success: boolean;
    summary: string;
    next_action: {
      type: "complete" | "retry" | "handoff";
      reason: string;
      handoff_id?: string;
    };
    outputs?: Array<{ path: string; description: string }>;
    evidence?: string[];
    satisfaction?: boolean;
    replan?: boolean;
  },
): void {
  writeResultContract(
    { artifacts: handoff.artifacts! },
    {
      version: "hydra/v2",
      handoff_id: handoff.id,
      workflow_id: handoff.workflow_id,
      success: result.success,
      summary: result.summary,
      outputs: result.outputs ?? [{ path: `${handoff.to.role}.md`, description: `${handoff.to.role} output` }],
      evidence: result.evidence ?? ["manual"],
      next_action: result.next_action,
      satisfaction: result.satisfaction,
      replan: result.replan,
    },
  );
  writeDoneMarker({
    artifacts: handoff.artifacts!,
    handoff_id: handoff.id,
    workflow_id: handoff.workflow_id,
  });
}

async function advancePieWorkflowToEvaluator(
  repoPath: string,
  workflowId: string,
  handoffIds: [string, string, string],
  manager: HandoffManager,
  dispatchOrder: string[],
): Promise<void> {
  const [plannerId, implementerId, evaluatorId] = handoffIds;
  const planner = manager.load(plannerId)!;
  writeHandoffResult(planner, {
    success: true,
    summary: "Planner produced a concrete implementation plan.",
    outputs: [{ path: "plan.md", description: "Implementation plan" }],
    evidence: ["manual planning"],
    next_action: {
      type: "handoff",
      reason: "Implementation can start.",
      handoff_id: implementerId,
    },
  });
  await tickWorkflow(
    { repoPath, workflowId },
    {
      now: () => "2026-03-26T12:00:10.000Z",
      dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
    },
  );

  const implementer = manager.load(implementerId)!;
  writeHandoffResult(implementer, {
    success: true,
    summary: "Implementer completed the requested change.",
    outputs: [{ path: "src/feature.ts", description: "Implementation" }],
    evidence: ["npm test"],
    next_action: {
      type: "handoff",
      reason: "Evaluation can start.",
      handoff_id: evaluatorId,
    },
  });
  await tickWorkflow(
    { repoPath, workflowId },
    {
      now: () => "2026-03-26T12:00:20.000Z",
      dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
    },
  );
}

async function advancePieWorkflowToSatisfactionCheck(
  repoPath: string,
  workflowId: string,
  handoffIds: [string, string, string],
  manager: HandoffManager,
  dispatchOrder: string[],
) {
  const [, , evaluatorId] = handoffIds;
  await advancePieWorkflowToEvaluator(repoPath, workflowId, handoffIds, manager, dispatchOrder);

  const evaluator = manager.load(evaluatorId)!;
  writeHandoffResult(evaluator, {
    success: true,
    summary: "Evaluator found no blocking issues.",
    outputs: [{ path: "report.md", description: "Evaluation report" }],
    evidence: ["npm test", "manual review"],
    next_action: { type: "complete", reason: "Evaluation passed." },
  });
  return tickWorkflow(
    { repoPath, workflowId },
    {
      now: () => "2026-03-26T12:00:30.000Z",
      dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
    },
  );
}

test("evaluator success dispatches a planner satisfaction check", async () => {
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
    const evaluator = manager.load(started.handoffs[2].id)!;
    const evaluatorTask = fs.readFileSync(evaluator.artifacts!.task_file, "utf-8");
    assert.match(evaluatorTask, /No evidence, no pass/i);

    const afterEvaluator = await advancePieWorkflowToSatisfactionCheck(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    const planner = manager.load(started.handoffs[0].id)!;
    const plannerTask = fs.readFileSync(planner.artifacts!.task_file, "utf-8");
    const controlPlanPath = path.join(planner.artifacts!.package_dir, "current-plan.json");
    assert.equal(afterEvaluator.workflow.status, "running");
    assert.equal(afterEvaluator.workflow.current_handoff_id, started.handoffs[0].id);
    assert.equal(dispatchOrder.length, 4);
    assert.match(plannerTask, /planner satisfaction check/i);
    assert.match(plannerTask, /satisfaction-context\.md/i);
    assert.match(plannerTask, /Use `success=true` whenever you reached a satisfaction decision/i);
    assert.ok(fs.existsSync(controlPlanPath));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("planner satisfaction success completes the workflow", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Complete the satisfaction loop",
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
        now: () => "2026-03-26T12:30:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await advancePieWorkflowToSatisfactionCheck(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    const workflow = loadWorkflow(repoPath, started.workflow.id)!;
    workflow.challenge_completed = true;
    saveWorkflow(workflow);

    const planner = manager.load(started.handoffs[0].id)!;
    writeHandoffResult(planner, {
      success: true,
      summary: "Planner is satisfied with the implementation outcome.",
      outputs: [{ path: "plan.md", description: "Final controlling plan" }],
      evidence: ["implementer result", "evaluator result"],
      satisfaction: true,
      next_action: { type: "complete", reason: "The workflow is satisfied." },
    });

    const completed = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:30:40.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch once planner is satisfied");
        },
      },
    );

    const status = getWorkflowStatus({ repoPath, workflowId: started.workflow.id });
    assert.equal(completed.workflow.status, "completed");
    assert.equal(completed.workflow.result?.satisfaction, true);
    assert.equal(status.handoffs[0].result?.satisfaction, true);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("planner satisfaction with replan=true resets all three handoffs", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Replan after evaluator feedback",
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
        now: () => "2026-03-26T12:40:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await advancePieWorkflowToSatisfactionCheck(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    const planner = manager.load(started.handoffs[0].id)!;
    writeHandoffResult(planner, {
      success: true,
      summary: "Planner determined the current plan is wrong and must be rebuilt.",
      outputs: [{ path: "plan.md", description: "Replanned workflow" }],
      evidence: ["implementer result", "evaluator result"],
      satisfaction: false,
      replan: true,
      next_action: {
        type: "handoff",
        reason: "A fresh plan is required.",
        handoff_id: started.handoffs[0].id,
      },
    });

    const replanned = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:40:40.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    const status = getWorkflowStatus({ repoPath, workflowId: started.workflow.id });
    const replannedPlanner = manager.load(started.handoffs[0].id)!;
    const replannedTask = fs.readFileSync(replannedPlanner.artifacts!.task_file, "utf-8");

    assert.equal(replanned.workflow.status, "running");
    assert.equal(replanned.workflow.current_handoff_id, started.handoffs[0].id);
    assert.equal(dispatchOrder.length, 5);
    assert.equal(status.handoffs[0].status, "in_progress");
    assert.equal(status.handoffs[1].status, "pending");
    assert.equal(status.handoffs[2].status, "pending");
    assert.match(replannedTask, /replanning from scratch/i);
    assert.match(replannedTask, /replan-context\.md/i);
    assert.match(replannedTask, /Implementer result/i);
    assert.match(replannedTask, /Evaluator result/i);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("failed replanning preserves the last good controlling plan snapshot", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Keep the previous plan available when replanning fails",
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
        now: () => "2026-03-26T12:45:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await advancePieWorkflowToSatisfactionCheck(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    const planner = manager.load(started.handoffs[0].id)!;
    const controlPlanPath = path.join(planner.artifacts!.package_dir, "current-plan.json");
    const originalControlPlan = fs.readFileSync(controlPlanPath, "utf-8");
    writeHandoffResult(planner, {
      success: true,
      summary: "Planner determined the current plan is wrong and must be rebuilt.",
      outputs: [{ path: "plan.md", description: "Replanned workflow" }],
      evidence: ["implementer result", "evaluator result"],
      satisfaction: false,
      replan: true,
      next_action: {
        type: "handoff",
        reason: "A fresh plan is required.",
        handoff_id: started.handoffs[0].id,
      },
    });

    await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:45:30.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const replanner = manager.load(started.handoffs[0].id)!;
    writeHandoffResult(replanner, {
      success: false,
      summary: "Planner could not produce a safe replacement plan yet.",
      outputs: [{ path: "decision.md", description: "Failed replanning attempt" }],
      evidence: ["manual review"],
      next_action: {
        type: "handoff",
        reason: "Replanning failed before a new plan was ready.",
        handoff_id: started.handoffs[0].id,
      },
    });

    const failed = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:45:50.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch once replanning fails");
        },
      },
    );

    assert.equal(failed.workflow.status, "failed");
    assert.equal(failed.workflow.failure?.code, "WORKFLOW_TEMPLATE_STAGE_FAILED");
    assert.equal(fs.readFileSync(controlPlanPath, "utf-8"), originalControlPlan);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("planner satisfaction with replan=false loops only implementer and evaluator", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Keep the same plan but continue implementation",
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
        now: () => "2026-03-26T12:50:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await advancePieWorkflowToSatisfactionCheck(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    const planner = manager.load(started.handoffs[0].id)!;
    const controlPlanPath = path.join(planner.artifacts!.package_dir, "current-plan.json");
    const controlPlanBeforeLoop = fs.readFileSync(controlPlanPath, "utf-8");
    writeHandoffResult(planner, {
      success: true,
      summary: "Planner wants the same plan to continue with more implementation work.",
      outputs: [{ path: "decision.md", description: "Satisfaction decision only" }],
      evidence: ["implementer result", "evaluator result"],
      satisfaction: false,
      replan: false,
      next_action: {
        type: "handoff",
        reason: "The same plan should continue.",
        handoff_id: started.handoffs[1].id,
      },
    });

    const looped = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:50:40.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    const status = getWorkflowStatus({ repoPath, workflowId: started.workflow.id });

    assert.equal(looped.workflow.status, "running");
    assert.equal(looped.workflow.current_handoff_id, started.handoffs[1].id);
    assert.equal(dispatchOrder.length, 5);
    assert.equal(status.handoffs[0].status, "completed");
    assert.equal(status.handoffs[0].result?.satisfaction, false);
    assert.equal(status.handoffs[0].result?.replan, false);
    assert.equal(status.handoffs[1].status, "in_progress");
    assert.equal(status.handoffs[2].status, "pending");
    assert.equal(fs.readFileSync(controlPlanPath, "utf-8"), controlPlanBeforeLoop);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("planner dissatisfaction still routes when the result uses success=false", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Tolerate planner dissatisfaction encoded as success=false",
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
        now: () => "2026-03-26T12:55:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await advancePieWorkflowToSatisfactionCheck(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    const planner = manager.load(started.handoffs[0].id)!;
    writeHandoffResult(planner, {
      success: false,
      summary: "Not satisfied yet; the same plan should continue.",
      outputs: [{ path: "decision.md", description: "Satisfaction decision only" }],
      evidence: ["implementer result", "evaluator result"],
      satisfaction: false,
      replan: false,
      next_action: {
        type: "handoff",
        reason: "The same plan should continue.",
        handoff_id: started.handoffs[1].id,
      },
    });

    const looped = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:55:40.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(looped.workflow.status, "running");
    assert.equal(looped.workflow.current_handoff_id, started.handoffs[1].id);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("workflow fails when the satisfaction iteration cap is reached", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Stop infinite satisfaction loops",
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
        now: () => "2026-03-26T13:00:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await advancePieWorkflowToEvaluator(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    const workflow = loadWorkflow(repoPath, started.workflow.id)!;
    workflow.max_satisfaction_iterations = 0;
    saveWorkflow(workflow);

    const evaluator = manager.load(started.handoffs[2].id)!;
    writeHandoffResult(evaluator, {
      success: true,
      summary: "Evaluator found no blocking issues.",
      outputs: [{ path: "report.md", description: "Evaluation report" }],
      evidence: ["npm test", "manual review"],
      next_action: { type: "complete", reason: "Evaluation passed." },
    });

    const failed = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T13:00:30.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(failed.workflow.status, "failed");
    assert.equal(failed.workflow.failure?.code, "WORKFLOW_MAX_SATISFACTION_ITERATIONS_REACHED");
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
    const implHandoff = manager.load(started.handoffs[1].id)!;
    assert.ok(!fs.existsSync(implHandoff.artifacts!.done_file), "stale implementer done file should be removed");

    // A subsequent tick should see the handoff as still in-progress (waiting),
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
