import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AssignmentManager } from "../src/assignment/manager.ts";
import type { AssignmentRecord } from "../src/assignment/types.ts";
import {
  approveWorkflow,
  getWorkflowStatus,
  requestWorkflowChallenge,
  resolveWorkflowChallenge,
  reviseWorkflow,
  runWorkflow,
  tickWorkflow,
} from "../src/workflow.ts";
import { loadWorkflow } from "../src/workflow-store.ts";
import {
  assignmentRequiresBrief,
  buildAssignmentTaskSpec,
  buildWorkflowTemplatePlan,
  resolveTemplateAdvance,
  workflowUserRequestFile,
} from "../src/workflow-template.ts";
import {
  getRunBriefFile,
  getRunResultFile,
  getWorkflowRevisionRequestPath,
} from "../src/layout.ts";
import { WORKFLOW_RESULT_SCHEMA_VERSION, type WorkflowResultContract } from "../src/protocol.ts";

function createRepoFixture() {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-template-"));
  const worktreePath = path.join(repoPath, "worktree");
  fs.mkdirSync(worktreePath, { recursive: true });
  return {
    repoPath,
    worktreePath,
  };
}

function latestRun(assignment: AssignmentRecord): AssignmentRecord["runs"][number] {
  const active = assignment.active_run_id
    ? assignment.runs.find((run) => run.id === assignment.active_run_id)
    : null;
  const run = active ?? assignment.runs[assignment.runs.length - 1] ?? null;
  assert.ok(run, `expected a run for assignment ${assignment.id}`);
  return run;
}

function createDispatchCreateOnly(dispatchOrder: string[]) {
  return async (request: {
    assignmentId?: string;
    agentType: string;
    taskFile: string;
    parentTerminalId?: string;
  }) => {
    dispatchOrder.push(request.assignmentId ?? "<unknown>");
    return {
      projectId: "project-1",
      terminalId: `terminal-${dispatchOrder.length}`,
      terminalType: request.agentType,
      terminalTitle: request.agentType,
      prompt: `Read ${request.taskFile}`,
    };
  };
}

function managerFor(repoPath: string, workflowId: string): AssignmentManager {
  return new AssignmentManager(repoPath, workflowId);
}

function writeAssignmentOutcome(
  workflowId: string,
  repoPath: string,
  assignment: AssignmentRecord,
  result: Omit<WorkflowResultContract, "schema_version" | "workflow_id" | "assignment_id" | "run_id">,
  options?: {
    briefContent?: string;
  },
): void {
  const run = latestRun(assignment);
  if (assignmentRequiresBrief(assignment.kind)) {
    fs.writeFileSync(
      getRunBriefFile(repoPath, workflowId, assignment.id, run.id),
      options?.briefContent ?? `# brief\n\nGenerated for ${assignment.kind}.`,
      "utf-8",
    );
  }
  fs.writeFileSync(
    run.result_file,
    JSON.stringify({
      schema_version: WORKFLOW_RESULT_SCHEMA_VERSION,
      workflow_id: workflowId,
      assignment_id: assignment.id,
      run_id: run.id,
      ...result,
    }),
    "utf-8",
  );
}

async function moveWorkflowToApproval(
  repoPath: string,
  workflowId: string,
  dispatchOrder: string[],
) {
  const workflow = loadWorkflow(repoPath, workflowId);
  assert.ok(workflow);
  const manager = managerFor(repoPath, workflowId);
  const researcher = manager.load(workflow.assignment_ids[0]);
  assert.ok(researcher);
  writeAssignmentOutcome(
    workflow.id,
    repoPath,
    researcher,
    {
      success: true,
      summary: "Research completed and ready for approval.",
      outputs: [{ kind: "brief", path: "artifacts/brief.md", description: "Research brief" }],
      evidence: ["code inspection"],
      next_action: {
        type: "transition",
        reason: "Research is ready for implementation after approval.",
        assignment_id: workflow.assignment_ids[1],
      },
    },
    {
      briefContent: "# research brief\n\nProceed.",
    },
  );

  return tickWorkflow(
    { repoPath, workflowId },
    {
      now: () => "2026-03-26T12:00:10.000Z",
      dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
    },
  );
}

test("buildWorkflowTemplatePlan creates the researcher -> implementer -> tester pipeline", () => {
  const plan = buildWorkflowTemplatePlan({
    template: "researcher-implementer-tester",
    workflowId: "wf-1",
    task: "Ship the feature",
    researcherAgentType: "claude",
    implementerAgentType: "codex",
    testerAgentType: "gemini",
    repoPath: "/repo",
    assignmentIds: ["asg-res", "asg-impl", "asg-test"],
  });

  assert.equal(plan.startAssignmentId, "asg-res");
  assert.deepEqual(plan.assignments, [
    {
      id: "asg-res",
      role: "researcher",
      kind: "research",
      from_assignment_id: null,
      requested_agent_type: "claude",
    },
    {
      id: "asg-impl",
      role: "implementer",
      kind: "implementation",
      from_assignment_id: "asg-res",
      requested_agent_type: "codex",
    },
    {
      id: "asg-test",
      role: "tester",
      kind: "verification",
      from_assignment_id: "asg-impl",
      requested_agent_type: "gemini",
    },
  ]);
});

test("buildAssignmentTaskSpec renders role-specific read refs and write targets", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  try {
    const started = await runWorkflow(
      {
        task: "Build the full workflow template",
        repoPath,
        worktreePath,
        template: "researcher-implementer-tester",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:00:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly([]),
      },
    );

    const workflow = loadWorkflow(repoPath, started.workflow.id);
    assert.ok(workflow);
    const manager = managerFor(repoPath, workflow.id);
    const assignments = new Map(
      workflow.assignment_ids.map((assignmentId) => {
        const assignment = manager.load(assignmentId);
        assert.ok(assignment);
        return [assignmentId, assignment];
      }),
    );

    const researcher = assignments.get(workflow.assignment_ids[0]);
    assert.ok(researcher);
    const researcherSpec = buildAssignmentTaskSpec({
      workflow,
      assignment: researcher,
      assignmentsById: assignments,
      runId: "run-preview",
    });
    assert.equal(researcherSpec.role, "researcher");
    assert.match(researcherSpec.readFiles[0]?.path ?? "", /inputs\/user-request\.md$/);
    assert.equal(researcherSpec.writeTargets.some((target) => target.path.endsWith("/artifacts/brief.md")), true);

    await moveWorkflowToApproval(repoPath, workflow.id, []);
    await approveWorkflow(
      { repoPath, workflowId: workflow.id },
      {
        now: () => "2026-03-26T12:00:20.000Z",
        dispatchCreateOnly: createDispatchCreateOnly([]),
      },
    );

    const approvedWorkflow = loadWorkflow(repoPath, workflow.id);
    assert.ok(approvedWorkflow);
    const approvedAssignments = new Map(
      approvedWorkflow.assignment_ids.map((assignmentId) => {
        const assignment = manager.load(assignmentId);
        assert.ok(assignment);
        return [assignmentId, assignment];
      }),
    );
    const implementer = approvedAssignments.get(approvedWorkflow.assignment_ids[1]);
    assert.ok(implementer);
    const implementerSpec = buildAssignmentTaskSpec({
      workflow: approvedWorkflow,
      assignment: implementer,
      assignmentsById: approvedAssignments,
      runId: "run-preview-2",
    });
    const readLabels = implementerSpec.readFiles.map((file) => file.label);
    assert.deepEqual(readLabels.slice(0, 3), [
      "User request",
      "Approved research brief",
      "Approved research result",
    ]);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("resolveTemplateAdvance encodes the main assignment transitions", () => {
  const assignments = ["asg-res", "asg-impl", "asg-test"];

  assert.deepEqual(
    resolveTemplateAdvance(
      "researcher-implementer-tester",
      assignments,
      "asg-res",
      {
        success: true,
        summary: "Research complete",
        next_action: { type: "transition", reason: "Ready", assignment_id: "asg-impl" },
      },
      { currentKind: "research" },
    ),
    {
      outcome: "await_approval",
      nextAssignmentId: "asg-impl",
    },
  );

  assert.deepEqual(
    resolveTemplateAdvance(
      "researcher-implementer-tester",
      assignments,
      "asg-impl",
      {
        success: true,
        summary: "Implementation needs replan",
        replan: true,
        next_action: { type: "transition", reason: "Approved assumptions failed", assignment_id: "asg-res" },
      },
      { currentKind: "implementation" },
    ),
    {
      outcome: "loop",
      nextAssignmentId: "asg-res",
      requeueAssignmentIds: ["asg-res", "asg-impl"],
    },
  );

  assert.deepEqual(
    resolveTemplateAdvance(
      "researcher-implementer-tester",
      assignments,
      "asg-test",
      {
        success: true,
        summary: "Verification passed",
        next_action: { type: "transition", reason: "Intent confirmation", assignment_id: "asg-res" },
      },
      { currentKind: "verification" },
    ),
    {
      outcome: "intent_confirmation",
      nextAssignmentId: "asg-res",
      requeueAssignmentIds: ["asg-res"],
    },
  );

  assert.deepEqual(
    resolveTemplateAdvance(
      "researcher-implementer-tester",
      assignments,
      "asg-res",
      {
        success: true,
        summary: "Ready to end",
        next_action: { type: "complete", reason: "Intent confirmed" },
      },
      { currentKind: "intent_confirmation" },
    ),
    {
      outcome: "complete",
    },
  );
});

test("researcher success pauses the workflow for approval and writes the workflow user request", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Build the full workflow template",
        repoPath,
        worktreePath,
        template: "researcher-implementer-tester",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:00:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(started.assignments.length, 3);
    assert.deepEqual(started.assignments.map((assignment) => assignment.role), [
      "researcher",
      "implementer",
      "tester",
    ]);
    const userRequestFile = workflowUserRequestFile(repoPath, started.workflow.id);
    assert.equal(fs.existsSync(userRequestFile), true);

    const awaitingApproval = await moveWorkflowToApproval(repoPath, started.workflow.id, dispatchOrder);
    assert.equal(awaitingApproval.workflow.status, "waiting_for_approval");
    assert.deepEqual(dispatchOrder, [started.workflow.assignment_ids[0]!]);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("approval stores immutable research refs, then the workflow advances through implementation, verification, and intent confirmation", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Ship the feature safely",
        repoPath,
        worktreePath,
        template: "researcher-implementer-tester",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:00:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    await moveWorkflowToApproval(repoPath, started.workflow.id, dispatchOrder);
    const approved = await approveWorkflow(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:00:20.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    assert.equal(approved.workflow.current_assignment_id, approved.workflow.assignment_ids[1]);
    assert.equal(approved.workflow.approved_refs?.research?.assignment_id, approved.workflow.assignment_ids[0]);
    assert.match(approved.workflow.approved_refs?.research?.brief_file ?? "", /artifacts\/brief\.md$/);

    const manager = managerFor(repoPath, started.workflow.id);
    const implementer = manager.load(approved.workflow.assignment_ids[1]);
    assert.ok(implementer);
    writeAssignmentOutcome(
      approved.workflow.id,
      repoPath,
      implementer,
      {
        success: true,
        summary: "Implementation finished.",
        outputs: [{ kind: "brief", path: "artifacts/brief.md", description: "Implementation brief" }],
        evidence: ["npm test"],
        next_action: {
          type: "transition",
          reason: "Verification can begin.",
          assignment_id: approved.workflow.assignment_ids[2],
        },
      },
      {
        briefContent: "# implementation brief\n\nWhat changed.",
      },
    );
    const verifying = await tickWorkflow(
      { repoPath, workflowId: approved.workflow.id },
      {
        now: () => "2026-03-26T12:00:30.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    assert.equal(verifying.workflow.current_assignment_id, verifying.workflow.assignment_ids[2]);

    const tester = manager.load(verifying.workflow.assignment_ids[2]);
    assert.ok(tester);
    writeAssignmentOutcome(
      verifying.workflow.id,
      repoPath,
      tester,
      {
        success: true,
        summary: "Verification passed.",
        outputs: [{ kind: "brief", path: "artifacts/brief.md", description: "Verification brief" }],
        evidence: ["npm test", "manual"],
        next_action: {
          type: "transition",
          reason: "Intent confirmation can begin.",
          assignment_id: verifying.workflow.assignment_ids[0],
        },
      },
      {
        briefContent: "# verification brief\n\nEverything passes.",
      },
    );
    const confirming = await tickWorkflow(
      { repoPath, workflowId: verifying.workflow.id },
      {
        now: () => "2026-03-26T12:00:40.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    assert.equal(confirming.workflow.current_assignment_id, confirming.workflow.assignment_ids[0]);
    const researcherForIntent = manager.load(confirming.workflow.assignment_ids[0]);
    assert.ok(researcherForIntent);
    assert.equal(researcherForIntent.kind, "intent_confirmation");

    writeAssignmentOutcome(
      confirming.workflow.id,
      repoPath,
      researcherForIntent,
      {
        success: true,
        summary: "Intent confirmed. Workflow complete.",
        outputs: [],
        evidence: ["approved brief", "verified implementation"],
        next_action: {
          type: "complete",
          reason: "Approved intent matches the verified implementation.",
        },
      },
    );
    const completed = await tickWorkflow(
      { repoPath, workflowId: confirming.workflow.id },
      {
        now: () => "2026-03-26T12:00:50.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(completed.workflow.status, "completed");
    assert.equal(completed.workflow.result?.summary, "Intent confirmed. Workflow complete.");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("reviseWorkflow writes a revision request and redispatches researcher", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Need a revised plan",
        repoPath,
        worktreePath,
        template: "researcher-implementer-tester",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:10:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    await moveWorkflowToApproval(repoPath, started.workflow.id, dispatchOrder);
    const revised = await reviseWorkflow(
      {
        repoPath,
        workflowId: started.workflow.id,
        feedback: "Focus more on migration risk and compatibility.",
      },
      {
        now: () => "2026-03-26T12:10:20.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    const revisionFile = getWorkflowRevisionRequestPath(repoPath, started.workflow.id);
    assert.equal(fs.existsSync(revisionFile), true);
    assert.match(fs.readFileSync(revisionFile, "utf-8"), /migration risk and compatibility/i);
    assert.equal(revised.workflow.current_assignment_id, revised.workflow.assignment_ids[0]);
    assert.equal(dispatchOrder.length, 2);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("challenge can start at the approval boundary and resolve back to waiting_for_approval", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Challenge the approval boundary",
        repoPath,
        worktreePath,
        template: "researcher-implementer-tester",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:20:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    await moveWorkflowToApproval(repoPath, started.workflow.id, dispatchOrder);
    const challenged = await requestWorkflowChallenge(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:20:20.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    assert.equal(challenged.workflow.status, "challenging");
    assert.ok(challenged.workflow.challenge);
    const firstChallengeTask = fs.readFileSync(challenged.workflow.challenge.workers[0]!.task_file, "utf-8");
    assert.match(firstChallengeTask, /\.tmp first, then atomically rename/i);

    for (const worker of challenged.workflow.challenge.workers) {
      fs.writeFileSync(
        worker.result_file,
        JSON.stringify({
          schema_version: WORKFLOW_RESULT_SCHEMA_VERSION,
          workflow_id: challenged.workflow.id,
          assignment_id: worker.id,
          run_id: worker.id,
          success: true,
          summary: "No blocking challenge findings.",
          findings: [],
          outputs: [],
          evidence: [`challenge:${worker.methodology}`],
          next_action: { type: "complete", reason: "Challenge complete" },
        }),
        "utf-8",
      );
    }

    const awaitingDecision = await tickWorkflow(
      { repoPath, workflowId: challenged.workflow.id },
      {
        now: () => "2026-03-26T12:20:30.000Z",
      },
    );
    assert.equal(awaitingDecision.workflow.status, "waiting_for_challenge_decision");

    const continued = await resolveWorkflowChallenge(
      { repoPath, workflowId: challenged.workflow.id, decision: "continue" },
      {
        now: () => "2026-03-26T12:20:40.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    assert.equal(continued.workflow.status, "waiting_for_approval");
    assert.equal(getWorkflowStatus({ repoPath, workflowId: started.workflow.id }).workflow.status, "waiting_for_approval");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("challenge fails the workflow when worker results are invalid", async () => {
  const { repoPath, worktreePath } = createRepoFixture();
  const dispatchOrder: string[] = [];

  try {
    const started = await runWorkflow(
      {
        task: "Challenge invalid worker output",
        repoPath,
        worktreePath,
        template: "researcher-implementer-tester",
        agentType: "codex",
        testerType: "claude",
        timeoutMinutes: 5,
        maxRetries: 1,
        autoApprove: false,
      },
      {
        now: () => "2026-03-26T12:30:00.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );

    await moveWorkflowToApproval(repoPath, started.workflow.id, dispatchOrder);
    const challenged = await requestWorkflowChallenge(
      { repoPath, workflowId: started.workflow.id },
      {
        now: () => "2026-03-26T12:30:20.000Z",
        dispatchCreateOnly: createDispatchCreateOnly(dispatchOrder),
      },
    );
    assert.equal(challenged.workflow.status, "challenging");
    assert.ok(challenged.workflow.challenge);

    for (const worker of challenged.workflow.challenge.workers) {
      fs.writeFileSync(worker.result_file, "{not-valid-json", "utf-8");
    }

    const failed = await tickWorkflow(
      { repoPath, workflowId: challenged.workflow.id },
      {
        now: () => "2026-03-26T12:30:30.000Z",
      },
    );

    assert.equal(failed.workflow.status, "failed");
    assert.equal(failed.workflow.failure?.code, "WORKFLOW_CHALLENGE_RESULT_INVALID");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
