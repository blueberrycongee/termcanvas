import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HandoffManager } from "../src/handoff/manager.ts";
import type { Handoff } from "../src/handoff/types.ts";
import { writeDoneMarker, writeResultContract } from "../src/collector.ts";
import {
  approveWorkflow,
  getWorkflowStatus,
  requestWorkflowChallenge,
  resolveWorkflowChallenge,
  reviseWorkflow,
  runWorkflow,
  tickWorkflow,
} from "../src/workflow.ts";
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
  return async (request: { handoffId: string; agentType: string; taskFile: string; parentTerminalId?: string }) => {
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

function writeRoleBrief(handoff: Handoff, content?: string): string | null {
  if (!handoff.artifacts) return null;

  const fileName = handoff.task.type === "workflow-implementation"
    ? "implementation-brief.md"
    : handoff.task.type === "workflow-verification"
      ? "verification-brief.md"
      : handoff.task.type === "workflow-research" || handoff.task.type === "workflow-research-replan"
        ? "research-brief.md"
        : null;

  if (!fileName) {
    return null;
  }

  const filePath = path.join(handoff.artifacts.package_dir, fileName);
  fs.writeFileSync(
    filePath,
    content ?? `# ${fileName}\n\nGenerated for ${handoff.task.type}.`,
    "utf-8",
  );
  return filePath;
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
    replan?: boolean;
    verification?: {
      runtime?: { ran: boolean; pass?: boolean; detail?: string };
      build?: { ran: boolean; pass?: boolean; detail?: string };
    };
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
      replan: result.replan,
      verification: result.verification,
    },
  );
  writeDoneMarker({
    artifacts: handoff.artifacts!,
    handoff_id: handoff.id,
    workflow_id: handoff.workflow_id,
  });
}

async function moveWorkflowToApproval(
  repoPath: string,
  workflowId: string,
  manager: HandoffManager,
  dispatchOrder: string[],
) {
  const workflow = loadWorkflow(repoPath, workflowId)!;
  const researcher = manager.load(workflow.handoff_ids[0])!;
  writeRoleBrief(researcher, "# research-brief\n\nIntent\n\nDecision: proceed.");
  writeHandoffResult(researcher, {
    success: true,
    summary: "Researcher completed the initial analysis.",
    outputs: [{ path: "research-brief.md", description: "Research handoff brief" }],
    evidence: ["code inspection"],
    next_action: {
      type: "handoff",
      reason: "Research is ready for approval.",
      handoff_id: workflow.handoff_ids[1],
    },
  });
  return tickWorkflow(
    { repoPath, workflowId },
    {
      now: () => "2026-03-26T12:00:10.000Z",
      dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
    },
  );
}

async function approveIntoImplementer(
  repoPath: string,
  workflowId: string,
  dispatchOrder: string[],
) {
  return approveWorkflow(
    { repoPath, workflowId },
    {
      now: () => "2026-03-26T12:00:20.000Z",
      dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
    },
  );
}

async function advanceWorkflowToTester(
  repoPath: string,
  workflowId: string,
  handoffIds: [string, string, string],
  manager: HandoffManager,
  dispatchOrder: string[],
) {
  await moveWorkflowToApproval(repoPath, workflowId, manager, dispatchOrder);
  await approveIntoImplementer(repoPath, workflowId, dispatchOrder);

  const implementer = manager.load(handoffIds[1])!;
  writeRoleBrief(implementer, "# implementation-brief\n\nChanges Made\n\n- Updated the feature.");
  writeHandoffResult(implementer, {
    success: true,
    summary: "Implementer completed the requested change.",
    outputs: [{ path: "implementation-brief.md", description: "Implementation handoff brief" }],
    evidence: ["npm test"],
    next_action: {
      type: "handoff",
      reason: "Verification can start.",
      handoff_id: handoffIds[2],
    },
  });
  return tickWorkflow(
    { repoPath, workflowId },
    {
      now: () => "2026-03-26T12:00:30.000Z",
      dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
    },
  );
}

async function advanceWorkflowToIntentConfirmation(
  repoPath: string,
  workflowId: string,
  handoffIds: [string, string, string],
  manager: HandoffManager,
  dispatchOrder: string[],
) {
  await advanceWorkflowToTester(repoPath, workflowId, handoffIds, manager, dispatchOrder);

  const tester = manager.load(handoffIds[2])!;
  writeRoleBrief(tester, "# verification-brief\n\nChecks Run\n\n- npm test\n- manual review");
  return tester;
}

function completeActiveChallenge(
  repoPath: string,
  workflowId: string,
  summary = "Challenge found no blocking issues.",
): void {
  const workflow = loadWorkflow(repoPath, workflowId)!;
  assert.ok(workflow.challenge, "expected an active challenge");

  for (const worker of workflow.challenge!.workers) {
    fs.writeFileSync(
      worker.result_file,
      JSON.stringify({
        success: true,
        summary,
        findings: [],
        outputs: [],
        evidence: [`challenge:${worker.methodology}`],
        next_action: { type: "complete", reason: "Challenge complete" },
      }, null, 2),
      "utf-8",
    );
    fs.writeFileSync(
      worker.done_file,
      JSON.stringify({
        workflow_id: workflowId,
        worker_id: worker.id,
        result_file: worker.result_file,
      }, null, 2),
      "utf-8",
    );
  }
}

test("researcher success pauses the workflow for approval", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Build the full workflow template",
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
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(started.handoffs.length, 3);
    assert.equal(started.handoffs[0].to.role, "researcher");
    assert.equal(started.handoffs[1].to.role, "implementer");
    assert.equal(started.handoffs[2].to.role, "tester");

    const manager = new HandoffManager(repoPath);
    const paused = await moveWorkflowToApproval(repoPath, started.workflow.id, manager, dispatchOrder);

    assert.equal(paused.workflow.status, "waiting_for_approval");
    assert.equal(dispatchOrder.length, 1);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("researcher must explicitly hand off to implementer before approval", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Build the full workflow template",
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
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const workflowId = started.workflow.id;
    const manager = new HandoffManager(repoPath);
    const researcher = manager.load(started.workflow.handoff_ids[0])!;
    writeRoleBrief(researcher, "# research-brief\n\nIntent\n\nDecision: proceed.");
    writeHandoffResult(researcher, {
      success: true,
      summary: "Researcher forgot to hand off to implementer.",
      outputs: [{ path: "research-brief.md", description: "Research handoff brief" }],
      evidence: ["code inspection"],
      next_action: {
        type: "complete",
        reason: "Incorrectly attempting to finish early.",
      },
    });

    const ticked = await tickWorkflow(
      { repoPath, workflowId },
      {
        now: () => "2026-03-26T12:00:10.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(ticked.workflow.status, "failed");
    assert.equal(ticked.workflow.failure?.code, "WORKFLOW_INVALID_RESEARCHER_ACTION");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("approve copies the approved research snapshot and dispatches the implementer", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Approve the research snapshot",
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
        now: () => "2026-03-26T12:05:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await moveWorkflowToApproval(repoPath, started.workflow.id, manager, dispatchOrder);

    const approved = await approveIntoImplementer(repoPath, started.workflow.id, dispatchOrder);
    const workflowDir = path.join(repoPath, ".hydra", "workflows", started.workflow.id);
    const approvedResult = path.join(workflowDir, "approved-research.json");
    const approvedBrief = path.join(workflowDir, "approved-research-brief.md");

    assert.equal(approved.workflow.status, "running");
    assert.equal(approved.workflow.current_handoff_id, started.workflow.handoff_ids[1]);
    assert.equal(dispatchOrder.length, 2);
    assert.ok(fs.existsSync(approvedResult));
    assert.ok(fs.existsSync(approvedBrief));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("explicit challenge request intercepts the implementer-to-tester boundary", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Challenge the implementation boundary",
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
        now: () => "2026-03-26T12:07:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    await moveWorkflowToApproval(repoPath, started.workflow.id, new HandoffManager(repoPath), dispatchOrder);
    await approveIntoImplementer(repoPath, started.workflow.id, dispatchOrder);

    const challenged = await requestWorkflowChallenge(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:07:25.000Z",
      },
    );
    assert.equal(challenged.workflow.challenge_request?.source_handoff_id, started.workflow.handoff_ids[1]);

    const manager = new HandoffManager(repoPath);
    const implementer = manager.load(started.workflow.handoff_ids[1])!;
    writeRoleBrief(implementer, "# implementation-brief\n\nChanges Made\n\n- Updated the feature.");
    writeHandoffResult(implementer, {
      success: true,
      summary: "Implementer completed the requested change.",
      outputs: [{ path: "implementation-brief.md", description: "Implementation handoff brief" }],
      evidence: ["npm test"],
      next_action: {
        type: "handoff",
        reason: "Verification can start.",
        handoff_id: started.workflow.handoff_ids[2],
      },
    });

    const intercepted = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:07:35.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(intercepted.workflow.status, "challenging");
    assert.equal(intercepted.workflow.challenge?.source_stage, "implementer");
    assert.equal(intercepted.workflow.challenge?.continue_target.outcome, "advance");
    assert.equal(intercepted.workflow.challenge?.continue_target.next_handoff_id, started.workflow.handoff_ids[2]);
    assert.equal(intercepted.workflow.challenge?.workers.length, 4);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("completed challenge can continue the original boundary transition", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Continue after explicit challenge",
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
        now: () => "2026-03-26T12:08:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    await moveWorkflowToApproval(repoPath, started.workflow.id, new HandoffManager(repoPath), dispatchOrder);
    await approveIntoImplementer(repoPath, started.workflow.id, dispatchOrder);
    await requestWorkflowChallenge(
      { repoPath, workflowId: started.workflow.id },
      { now: () => "2026-03-26T12:08:25.000Z" },
    );

    const manager = new HandoffManager(repoPath);
    const implementer = manager.load(started.workflow.handoff_ids[1])!;
    writeRoleBrief(implementer, "# implementation-brief\n\nChanges Made\n\n- Updated the feature.");
    writeHandoffResult(implementer, {
      success: true,
      summary: "Implementer completed the requested change.",
      outputs: [{ path: "implementation-brief.md", description: "Implementation handoff brief" }],
      evidence: ["npm test"],
      next_action: {
        type: "handoff",
        reason: "Verification can start.",
        handoff_id: started.workflow.handoff_ids[2],
      },
    });
    await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:08:35.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    completeActiveChallenge(repoPath, started.workflow.id);
    const readyForDecision = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:08:45.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    assert.equal(readyForDecision.workflow.status, "waiting_for_challenge_decision");
    assert.ok(readyForDecision.workflow.challenge?.report_file);

    const continued = await resolveWorkflowChallenge(
      {
        repoPath,
        workflowId: started.workflow.id,
        decision: "continue",
      },
      {
        now: () => "2026-03-26T12:08:55.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(continued.workflow.status, "running");
    assert.equal(continued.workflow.current_handoff_id, started.workflow.handoff_ids[2]);
    const tester = manager.load(started.workflow.handoff_ids[2])!;
    assert.equal(tester.status, "in_progress");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("completed challenge can send work back to the requested role", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Send work back after explicit challenge",
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
        now: () => "2026-03-26T12:09:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    await moveWorkflowToApproval(repoPath, started.workflow.id, new HandoffManager(repoPath), dispatchOrder);
    await approveIntoImplementer(repoPath, started.workflow.id, dispatchOrder);
    await requestWorkflowChallenge(
      { repoPath, workflowId: started.workflow.id },
      { now: () => "2026-03-26T12:09:25.000Z" },
    );

    const manager = new HandoffManager(repoPath);
    const implementer = manager.load(started.workflow.handoff_ids[1])!;
    writeRoleBrief(implementer, "# implementation-brief\n\nChanges Made\n\n- Updated the feature.");
    writeHandoffResult(implementer, {
      success: true,
      summary: "Implementer completed the requested change.",
      outputs: [{ path: "implementation-brief.md", description: "Implementation handoff brief" }],
      evidence: ["npm test"],
      next_action: {
        type: "handoff",
        reason: "Verification can start.",
        handoff_id: started.workflow.handoff_ids[2],
      },
    });
    await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:09:35.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    completeActiveChallenge(repoPath, started.workflow.id, "Challenge found issues that require more implementation.");
    await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:09:45.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const rerouted = await resolveWorkflowChallenge(
      {
        repoPath,
        workflowId: started.workflow.id,
        decision: "send_back",
        to: "implementer",
      },
      {
        now: () => "2026-03-26T12:09:55.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(rerouted.workflow.status, "running");
    assert.equal(rerouted.workflow.current_handoff_id, started.workflow.handoff_ids[1]);
    const refreshedImplementer = manager.load(started.workflow.handoff_ids[1])!;
    const tester = manager.load(started.workflow.handoff_ids[2])!;
    assert.equal(refreshedImplementer.status, "in_progress");
    assert.equal(tester.status, "pending");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("revise writes revision feedback and redispatches the researcher", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Revise the research pass",
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
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await moveWorkflowToApproval(repoPath, started.workflow.id, manager, dispatchOrder);

    const revised = await reviseWorkflow(
      {
        repoPath,
        workflowId: started.workflow.id,
        feedback: "Expand the architecture impact section and tighten the constraints.",
      },
      {
        now: () => "2026-03-26T12:10:20.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const researcher = manager.load(started.workflow.handoff_ids[0])!;
    const revisionFile = path.join(researcher.artifacts!.package_dir, "revision.md");
    const taskMd = fs.readFileSync(researcher.artifacts!.task_file, "utf-8");

    assert.equal(revised.workflow.status, "running");
    assert.equal(revised.workflow.current_handoff_id, started.workflow.handoff_ids[0]);
    assert.equal(dispatchOrder.length, 2);
    assert.ok(fs.existsSync(revisionFile));
    assert.match(taskMd, /revision\.md/i);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("implementer replan resets researcher and implementer, then redispatches replan research", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Replan after implementation discoveries",
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
        now: () => "2026-03-26T12:15:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await moveWorkflowToApproval(repoPath, started.workflow.id, manager, dispatchOrder);
    await approveIntoImplementer(repoPath, started.workflow.id, dispatchOrder);

    const implementer = manager.load(started.workflow.handoff_ids[1])!;
    writeRoleBrief(implementer, "# implementation-brief\n\nOpen Questions\n\n- Research assumptions do not hold.");
    writeHandoffResult(implementer, {
      success: true,
      summary: "Implementer found that the approved research frame is no longer valid.",
      outputs: [{ path: "implementation-brief.md", description: "Implementation handoff brief" }],
      evidence: ["code inspection"],
      replan: true,
      next_action: {
        type: "handoff",
        reason: "The workflow must return to research.",
        handoff_id: started.workflow.handoff_ids[0],
      },
    });

    const replanned = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:15:30.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const status = getWorkflowStatus({ repoPath, workflowId: started.workflow.id });
    const researcher = manager.load(started.workflow.handoff_ids[0])!;
    const taskMd = fs.readFileSync(researcher.artifacts!.task_file, "utf-8");

    assert.equal(replanned.workflow.status, "running");
    assert.equal(replanned.workflow.current_handoff_id, started.workflow.handoff_ids[0]);
    assert.equal(status.handoffs[0].status, "in_progress");
    assert.equal(status.handoffs[1].status, "pending");
    assert.equal(status.handoffs[2].status, "pending");
    assert.match(taskMd, /replan-context\.md/i);
    assert.match(taskMd, /approved research/i);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("tester failure loops back to the implementer handoff", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Build the tester loop",
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
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    await advanceWorkflowToTester(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    const tester = manager.load(started.workflow.handoff_ids[2])!;
    writeRoleBrief(tester, "# verification-brief\n\nFindings\n\n- Constraint not met.");
    writeHandoffResult(tester, {
      success: true,
      summary: "Tester found a blocking gap in the implementation.",
      outputs: [{ path: "verification-brief.md", description: "Verification handoff brief" }],
      evidence: ["manual review"],
      verification: {
        runtime: { ran: true, pass: false, detail: "Blocking issue remains." },
      },
      next_action: {
        type: "handoff",
        reason: "Implementation must continue.",
        handoff_id: started.workflow.handoff_ids[1],
      },
    });

    const looped = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:20:30.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    const status = getWorkflowStatus({ repoPath, workflowId: started.workflow.id });
    const implHandoff = manager.load(started.workflow.handoff_ids[1])!;

    assert.equal(looped.workflow.status, "running");
    assert.equal(looped.workflow.current_handoff_id, started.workflow.handoff_ids[1]);
    assert.equal(status.handoffs[1].status, "in_progress");
    assert.equal(status.handoffs[2].status, "pending");
    assert.ok(!fs.existsSync(implHandoff.artifacts!.done_file), "stale implementer done file should be removed");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("tester success dispatches researcher intent confirmation", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Launch intent confirmation after verification",
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
        now: () => "2026-03-26T12:25:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    const tester = await advanceWorkflowToIntentConfirmation(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    writeHandoffResult(tester, {
      success: true,
      summary: "Tester found no blocking issues.",
      outputs: [{ path: "verification-brief.md", description: "Verification handoff brief" }],
      evidence: ["npm test", "manual review"],
      verification: {
        runtime: { ran: true, pass: true, detail: "All checks passed." },
        build: { ran: true, pass: true, detail: "Build passed." },
      },
      next_action: {
        type: "handoff",
        reason: "Intent confirmation should start.",
        handoff_id: started.workflow.handoff_ids[0],
      },
    });

    const afterTester = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:25:30.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const researcher = manager.load(started.workflow.handoff_ids[0])!;
    const taskMd = fs.readFileSync(researcher.artifacts!.task_file, "utf-8");

    assert.equal(afterTester.workflow.status, "running");
    assert.equal(afterTester.workflow.current_handoff_id, started.workflow.handoff_ids[0]);
    assert.match(taskMd, /intent-confirmation-context\.md/i);
    assert.match(taskMd, /approved research/i);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("researcher intent confirmation can complete the workflow", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Finish the full workflow",
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
    const tester = await advanceWorkflowToIntentConfirmation(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );
    writeHandoffResult(tester, {
      success: true,
      summary: "Tester found no blocking issues.",
      outputs: [{ path: "verification-brief.md", description: "Verification handoff brief" }],
      evidence: ["npm test"],
      next_action: {
        type: "handoff",
        reason: "Intent confirmation should start.",
        handoff_id: started.workflow.handoff_ids[0],
      },
    });
    await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:30:20.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const researcher = manager.load(started.workflow.handoff_ids[0])!;
    writeHandoffResult(researcher, {
      success: true,
      summary: "Researcher confirms the delivered result matches the approved intent.",
      outputs: [{ path: "intent-confirmation.md", description: "Intent confirmation decision" }],
      evidence: ["approved research", "verification brief"],
      next_action: { type: "complete", reason: "The workflow is complete." },
    });

    const completed = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:30:40.000Z",
        dispatchCreateOnly: async () => {
          throw new Error("must not redispatch once the workflow is complete");
        },
      },
    );

    assert.equal(completed.workflow.status, "completed");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("researcher intent confirmation with replan=true resets all three handoffs", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Replan after intent confirmation",
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
        now: () => "2026-03-26T12:35:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const manager = new HandoffManager(repoPath);
    const tester = await advanceWorkflowToIntentConfirmation(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );
    writeHandoffResult(tester, {
      success: true,
      summary: "Tester found no blocking issues.",
      outputs: [{ path: "verification-brief.md", description: "Verification handoff brief" }],
      evidence: ["manual review"],
      next_action: {
        type: "handoff",
        reason: "Intent confirmation should start.",
        handoff_id: started.workflow.handoff_ids[0],
      },
    });
    await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:35:20.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const workflowDir = path.join(repoPath, ".hydra", "workflows", started.workflow.id);
    const approvedResult = path.join(workflowDir, "approved-research.json");
    const approvedBeforeReplan = fs.readFileSync(approvedResult, "utf-8");

    const researcher = manager.load(started.workflow.handoff_ids[0])!;
    writeHandoffResult(researcher, {
      success: true,
      summary: "Researcher determined the approved research frame must be rebuilt.",
      outputs: [{ path: "intent-confirmation.md", description: "Intent confirmation decision" }],
      evidence: ["approved research", "verification brief"],
      replan: true,
      next_action: {
        type: "handoff",
        reason: "The workflow must return to research.",
        handoff_id: started.workflow.handoff_ids[0],
      },
    });

    const replanned = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:35:40.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    const status = getWorkflowStatus({ repoPath, workflowId: started.workflow.id });
    const replannedResearcher = manager.load(started.workflow.handoff_ids[0])!;
    const taskMd = fs.readFileSync(replannedResearcher.artifacts!.task_file, "utf-8");

    assert.equal(replanned.workflow.status, "running");
    assert.equal(replanned.workflow.current_handoff_id, started.workflow.handoff_ids[0]);
    assert.equal(status.handoffs[0].status, "in_progress");
    assert.equal(status.handoffs[1].status, "pending");
    assert.equal(status.handoffs[2].status, "pending");
    assert.match(taskMd, /replan-context\.md/i);
    assert.equal(fs.readFileSync(approvedResult, "utf-8"), approvedBeforeReplan);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("researcher intent confirmation with replan=false loops implementer and tester only", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Continue implementation under the same approved research",
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
    const tester = await advanceWorkflowToIntentConfirmation(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );
    writeHandoffResult(tester, {
      success: true,
      summary: "Tester found no blocking issues.",
      outputs: [{ path: "verification-brief.md", description: "Verification handoff brief" }],
      evidence: ["manual review"],
      next_action: {
        type: "handoff",
        reason: "Intent confirmation should start.",
        handoff_id: started.workflow.handoff_ids[0],
      },
    });
    await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:40:20.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const researcher = manager.load(started.workflow.handoff_ids[0])!;
    writeHandoffResult(researcher, {
      success: true,
      summary: "The approved research still holds, but implementation must continue.",
      outputs: [{ path: "intent-confirmation.md", description: "Intent confirmation decision" }],
      evidence: ["approved research", "verification brief"],
      replan: false,
      next_action: {
        type: "handoff",
        reason: "Continue implementation under the same approved research.",
        handoff_id: started.workflow.handoff_ids[1],
      },
    });

    const looped = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:40:40.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    const status = getWorkflowStatus({ repoPath, workflowId: started.workflow.id });

    assert.equal(looped.workflow.status, "running");
    assert.equal(looped.workflow.current_handoff_id, started.workflow.handoff_ids[1]);
    assert.equal(status.handoffs[0].status, "completed");
    assert.equal(status.handoffs[1].status, "in_progress");
    assert.equal(status.handoffs[2].status, "pending");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("workflow fails when the intent-confirmation iteration cap is reached", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Stop infinite intent-confirmation loops",
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
    await advanceWorkflowToTester(
      repoPath,
      started.workflow.id,
      started.workflow.handoff_ids as [string, string, string],
      manager,
      dispatchOrder,
    );

    const workflow = loadWorkflow(repoPath, started.workflow.id)!;
    workflow.max_confirmation_iterations = 0;
    saveWorkflow(workflow);

    const tester = manager.load(started.workflow.handoff_ids[2])!;
    writeRoleBrief(tester, "# verification-brief\n\nChecks Run\n\n- Tests passed.");
    writeHandoffResult(tester, {
      success: true,
      summary: "Tester found no blocking issues.",
      outputs: [{ path: "verification-brief.md", description: "Verification handoff brief" }],
      evidence: ["npm test"],
      next_action: {
        type: "handoff",
        reason: "Intent confirmation should start.",
        handoff_id: started.workflow.handoff_ids[0],
      },
    });

    const failed = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:45:30.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(failed.workflow.status, "failed");
    assert.equal(failed.workflow.failure?.code, "WORKFLOW_MAX_CONFIRMATION_ITERATIONS_REACHED");
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
        now: () => "2026-03-26T12:50:00.000Z",
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
        now: () => "2026-03-26T12:55:00.000Z",
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
    await moveWorkflowToApproval(repoPath, started.workflow.id, manager, []);

    delete process.env.TERMCANVAS_TERMINAL_ID;

    await approveWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:55:20.000Z",
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

    const withinGrace = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
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
    assert.equal(dispatched.length, 1);

    const pastGrace = await tickWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
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
    assert.equal(dispatched.length, 2);

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
    assert.equal(dispatched.length, 2);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
