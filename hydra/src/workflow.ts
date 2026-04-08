import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { collectRunResult } from "./collector.ts";
import {
  dispatchCreateOnly as defaultDispatchCreateOnly,
  type DispatchCreateOnlyRequest,
  type DispatchCreateOnlyResult,
} from "./dispatcher.ts";
import { HydraError } from "./errors.ts";
import { AssignmentManager } from "./assignment/manager.ts";
import { AssignmentStateMachine } from "./assignment/state-machine.ts";
import type { AssignmentRecord, AgentType } from "./assignment/types.ts";
import { AUTO_APPROVE_AGENT_TYPES, resolveDefaultAgentType } from "./agent-selection.ts";
import {
  registerDispatchAttempt,
  hasAssignmentTimedOut,
  retryTimedOutAssignment,
} from "./retry.ts";
import { writeRunTask } from "./run-task.ts";
import {
  assignmentRequiresBrief,
  buildAssignmentTaskSpec,
  buildWorkflowTemplatePlan,
  resolveTemplateAdvance,
  workflowUserRequestFile,
  type TemplateAdvanceDecision,
  type WorkflowTemplateName,
} from "./workflow-template.ts";
import {
  collectChallengeResults,
  destroyChallengeTerminals,
  spawnChallengeWorkers,
  type ChallengeDecision,
  type ChallengeContextFile,
  type ChallengeContinueTarget,
  type ChallengeReturnTarget,
  type ChallengeStage,
} from "./challenge.ts";
import {
  deleteWorkflow,
  loadWorkflow,
  saveWorkflow,
  WORKFLOW_STATE_SCHEMA_VERSION,
  type WorkflowFailure,
  type WorkflowRecord,
} from "./workflow-store.ts";
import {
  ensureProjectTracked,
  findProjectByPath,
  isTermCanvasRunning,
  projectRescan,
  telemetryTerminal,
  terminalDestroy,
} from "./termcanvas.ts";
import { buildGitWorktreeAddArgs, validateWorktreePath } from "./spawn.ts";
import {
  getRunApprovalRequestFile,
  getRunArtifactsDir,
  getRunBriefFile,
  getRunResultFile,
  getRunTaskFile,
  getWorkflowRevisionRequestPath,
} from "./layout.ts";
import type { WorkflowResultContract } from "./protocol.ts";

const SPAWN_GRACE_PERIOD_MS = 15_000;
const DEFAULT_MAX_CONFIRMATION_ITERATIONS = 3;

export interface RunWorkflowOptions {
  task: string;
  repoPath: string;
  worktreePath?: string;
  template?: WorkflowTemplateName;
  researcherType?: AgentType;
  implementerType?: AgentType;
  agentType?: AgentType;
  testerType?: AgentType;
  timeoutMinutes: number;
  maxRetries: number;
  autoApprove: boolean;
}

export interface TickWorkflowOptions {
  repoPath: string;
  workflowId: string;
}

export interface WatchWorkflowOptions extends TickWorkflowOptions {
  intervalMs: number;
  timeoutMs?: number;
}

export interface RetryWorkflowOptions extends TickWorkflowOptions {}

export interface RequestWorkflowChallengeOptions extends TickWorkflowOptions {}

export interface ResolveWorkflowChallengeOptions extends TickWorkflowOptions {
  decision: "continue" | "send_back";
  to?: "researcher" | "implementer" | "tester";
}

export interface WorkflowStatusView {
  workflow: WorkflowRecord;
  assignments: AssignmentRecord[];
}

export interface WorkflowDependencies {
  now?: () => string;
  dispatchCreateOnly?: (request: DispatchCreateOnlyRequest) => Promise<DispatchCreateOnlyResult>;
  sleep?: (ms: number) => Promise<void>;
  syncProject?: (repoPath: string) => void;
  destroyTerminal?: (terminalId: string) => void;
  checkTerminalAlive?: (terminalId: string) => boolean | null;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultCheckTerminalAlive(terminalId: string): boolean | null {
  try {
    if (!isTermCanvasRunning()) return null;
    const telemetry = telemetryTerminal(terminalId);
    return telemetry?.pty_alive ?? null;
  } catch {
    return null;
  }
}

function checkTerminalAliveFn(dependencies: WorkflowDependencies | undefined) {
  return dependencies?.checkTerminalAlive ?? defaultCheckTerminalAlive;
}

function nowFn(dependencies: WorkflowDependencies | undefined): () => string {
  return dependencies?.now ?? (() => new Date().toISOString());
}

function dispatchFn(dependencies: WorkflowDependencies | undefined) {
  return dependencies?.dispatchCreateOnly ?? defaultDispatchCreateOnly;
}

function sleepFn(dependencies: WorkflowDependencies | undefined) {
  return dependencies?.sleep ?? DEFAULT_SLEEP;
}

function syncProjectFn(dependencies: WorkflowDependencies | undefined) {
  if (dependencies?.syncProject) return dependencies.syncProject;
  if (dependencies?.dispatchCreateOnly) {
    return (_repoPath: string) => {};
  }
  return ensureProjectTracked;
}

function destroyTerminalFn(dependencies: WorkflowDependencies | undefined) {
  if (dependencies?.destroyTerminal) return dependencies.destroyTerminal;
  if (dependencies?.dispatchCreateOnly) {
    return (_terminalId: string) => {};
  }
  return terminalDestroy;
}

function generateWorkflowId(): string {
  return `workflow-${crypto.randomBytes(6).toString("hex")}`;
}

function generateAssignmentId(): string {
  return `assignment-${crypto.randomBytes(6).toString("hex")}`;
}

function generateRunId(): string {
  return `run-${crypto.randomBytes(6).toString("hex")}`;
}

function getCurrentBranch(repoPath: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "main";
  }
}

function prepareWorkflowWorkspace(
  repoPath: string,
  workflowId: string,
  requestedWorktreePath: string | undefined,
  dependencies: WorkflowDependencies | undefined,
): { worktreePath: string; branch: string | null; baseBranch: string; ownWorktree: boolean } {
  const repo = path.resolve(repoPath);
  const baseBranch = getCurrentBranch(repo);

  if (requestedWorktreePath) {
    syncProjectFn(dependencies)(repo);
    return {
      worktreePath: validateWorktreePath(repo, requestedWorktreePath),
      branch: null,
      baseBranch,
      ownWorktree: false,
    };
  }

  const branch = `hydra/${workflowId}`;
  const worktreePath = path.join(repo, ".worktrees", workflowId);
  execFileSync("git", buildGitWorktreeAddArgs(branch, worktreePath, baseBranch), {
    cwd: repo,
    encoding: "utf-8",
  });

  const project = findProjectByPath(repo);
  if (project) {
    projectRescan(project.id);
  } else {
    syncProjectFn(dependencies)(repo);
  }

  return {
    worktreePath,
    branch,
    baseBranch,
    ownWorktree: true,
  };
}

function writeWorkflowUserRequest(repoPath: string, workflowId: string, task: string): string {
  const filePath = workflowUserRequestFile(repoPath, workflowId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      "# User Request",
      "",
      "This file is the canonical workflow-level statement of the user's request.",
      "Read it before relying on downstream briefs or results.",
      "",
      task,
      "",
    ].join("\n"),
    "utf-8",
  );
  try {
    fs.unlinkSync(getWorkflowRevisionRequestPath(repoPath, workflowId));
  } catch {}
  return filePath;
}

function loadWorkflowOrThrow(repoPath: string, workflowId: string): WorkflowRecord {
  const workflow = loadWorkflow(repoPath, workflowId);
  if (!workflow) {
    throw new HydraError(`Workflow not found: ${workflowId}`, {
      errorCode: "WORKFLOW_NOT_FOUND",
      stage: "workflow.load",
      ids: { workflow_id: workflowId },
    });
  }
  return workflow;
}

function managerForWorkflow(workflow: WorkflowRecord): AssignmentManager {
  return new AssignmentManager(workflow.repo_path, workflow.id);
}

function loadAssignmentOrThrow(manager: AssignmentManager, workflow: WorkflowRecord): AssignmentRecord {
  const assignment = manager.load(workflow.current_assignment_id);
  if (!assignment) {
    throw new HydraError(`Assignment not found: ${workflow.current_assignment_id}`, {
      errorCode: "WORKFLOW_ASSIGNMENT_NOT_FOUND",
      stage: "workflow.load_assignment",
      ids: {
        workflow_id: workflow.id,
        assignment_id: workflow.current_assignment_id,
      },
    });
  }
  return assignment;
}

function loadAssignmentByIdOrThrow(
  manager: AssignmentManager,
  workflow: WorkflowRecord,
  assignmentId: string,
): AssignmentRecord {
  const assignment = manager.load(assignmentId);
  if (!assignment) {
    throw new HydraError(`Assignment not found: ${assignmentId}`, {
      errorCode: "WORKFLOW_ASSIGNMENT_NOT_FOUND",
      stage: "workflow.load_assignment",
      ids: {
        workflow_id: workflow.id,
        assignment_id: assignmentId,
      },
    });
  }
  return assignment;
}

function getFullWorkflowAssignmentIds(workflow: WorkflowRecord): [string, string, string] {
  if (workflow.template !== "researcher-implementer-tester" || workflow.assignment_ids.length !== 3) {
    throw new HydraError(`Workflow ${workflow.id} is not a researcher-implementer-tester workflow`, {
      errorCode: "WORKFLOW_TEMPLATE_INVALID",
      stage: "workflow.template_state",
      ids: { workflow_id: workflow.id },
    });
  }
  return workflow.assignment_ids as [string, string, string];
}

function buildAssignmentsMap(manager: AssignmentManager, workflow: WorkflowRecord): Map<string, AssignmentRecord> {
  return new Map(
    workflow.assignment_ids.map((assignmentId) => [
      assignmentId,
      loadAssignmentByIdOrThrow(manager, workflow, assignmentId),
    ]),
  );
}

function latestRun(assignment: AssignmentRecord): AssignmentRecord["runs"][number] | null {
  if (assignment.runs.length === 0) return null;
  const active = assignment.active_run_id
    ? assignment.runs.find((run) => run.id === assignment.active_run_id)
    : null;
  return active ?? assignment.runs[assignment.runs.length - 1] ?? null;
}

function currentRunOrThrow(assignment: AssignmentRecord): AssignmentRecord["runs"][number] {
  const run = latestRun(assignment);
  if (!run) {
    throw new HydraError(`Assignment ${assignment.id} has no run`, {
      errorCode: "WORKFLOW_RUN_MISSING",
      stage: "workflow.current_run",
      ids: {
        workflow_id: assignment.workflow_id,
        assignment_id: assignment.id,
      },
    });
  }
  return run;
}

function buildAssignmentFailure(
  code: string,
  message: string,
  stage: string,
): WorkflowFailure {
  return { code, message, stage };
}

function destroyAssignmentTerminal(
  assignment: AssignmentRecord,
  dependencies: WorkflowDependencies | undefined,
): void {
  const run = latestRun(assignment);
  if (!run?.terminal_id) return;
  try {
    destroyTerminalFn(dependencies)(run.terminal_id);
  } catch {}
}

function buildDispatchRequest(
  workflow: WorkflowRecord,
  assignment: AssignmentRecord,
  runId: string,
): DispatchCreateOnlyRequest {
  return {
    workflowId: workflow.id,
    assignmentId: assignment.id,
    runId,
    repoPath: workflow.repo_path,
    worktreePath: workflow.worktree_path,
    agentType: assignment.requested_agent_type,
    taskFile: getRunTaskFile(workflow.repo_path, workflow.id, assignment.id, runId),
    resultFile: getRunResultFile(workflow.repo_path, workflow.id, assignment.id, runId),
    autoApprove: workflow.auto_approve,
    parentTerminalId:
      workflow.parent_terminal_id ?? process.env.TERMCANVAS_TERMINAL_ID,
  };
}

function mapWorkflowResult(result: WorkflowResultContract): NonNullable<AssignmentRecord["result"]> {
  return {
    success: result.success,
    summary: result.summary,
    outputs: result.outputs,
    evidence: result.evidence,
    verification: result.verification,
    satisfaction: result.satisfaction,
    replan: result.replan,
    next_action: result.next_action,
  };
}

function saveWorkflowFailure(
  workflow: WorkflowRecord,
  failure: WorkflowFailure,
  updatedAt: string,
): WorkflowRecord {
  workflow.status = "failed";
  workflow.failure = failure;
  workflow.updated_at = updatedAt;
  saveWorkflow(workflow);
  return workflow;
}

function persistApprovedResearchRef(
  workflow: WorkflowRecord,
  researchAssignment: AssignmentRecord,
  approvedAt: string,
): void {
  const run = currentRunOrThrow(researchAssignment);
  workflow.approved_refs = {
    ...workflow.approved_refs,
    research: {
      assignment_id: researchAssignment.id,
      run_id: run.id,
      brief_file: getRunBriefFile(workflow.repo_path, workflow.id, researchAssignment.id, run.id),
      result_file: run.result_file,
      approved_at: approvedAt,
    },
  };
}

function validateRequiredWorkflowArtifacts(
  workflow: WorkflowRecord,
  assignment: AssignmentRecord,
  runId: string,
): WorkflowFailure | null {
  if (workflow.template !== "researcher-implementer-tester") {
    return null;
  }

  if (!assignmentRequiresBrief(assignment.kind)) {
    return null;
  }

  const requiredPath = getRunBriefFile(workflow.repo_path, workflow.id, assignment.id, runId);
  if (fs.existsSync(requiredPath)) {
    return null;
  }

  return {
    code: "WORKFLOW_REQUIRED_ARTIFACT_MISSING",
    message: `Expected brief at ${requiredPath} before completing ${assignment.kind}.`,
    stage: "workflow.required_artifact",
  };
}

function resetAssignmentToPending(
  manager: AssignmentManager,
  assignmentId: string,
  now: string,
): void {
  const assignment = manager.load(assignmentId);
  if (!assignment) {
    throw new HydraError(`Assignment not found: ${assignmentId}`, {
      errorCode: "WORKFLOW_ASSIGNMENT_NOT_FOUND",
      stage: "workflow.requeue",
      ids: { assignment_id: assignmentId },
    });
  }

  const previousStatus = assignment.status;
  assignment.status = "pending";
  assignment.updated_at = now;
  assignment.status_updated_at = now;
  assignment.claim = undefined;
  assignment.last_error = undefined;
  assignment.result = undefined;
  assignment.active_run_id = null;
  assignment.transitions = assignment.transitions ?? [];
  assignment.transitions.push({
    event: "requeue_assignment",
    from: previousStatus,
    to: "pending",
    at: now,
  });
  manager.save(assignment);
}

function resetFailedOrTimedOutAssignment(
  manager: AssignmentManager,
  workflow: WorkflowRecord,
  assignment: AssignmentRecord,
  now: string,
): AssignmentRecord {
  if (assignment.status !== "failed" && assignment.status !== "timed_out") {
    throw new HydraError(`Workflow ${workflow.id} is not retryable`, {
      errorCode: "WORKFLOW_NOT_RETRYABLE",
      stage: "workflow.retry",
      ids: {
        workflow_id: workflow.id,
        assignment_id: assignment.id,
      },
    });
  }

  if (assignment.retry_count >= assignment.max_retries) {
    throw new HydraError(`Retry limit reached for ${assignment.id}`, {
      errorCode: "WORKFLOW_RETRY_LIMIT_REACHED",
      stage: "workflow.retry",
      ids: {
        workflow_id: workflow.id,
        assignment_id: assignment.id,
      },
    });
  }

  const previousStatus = assignment.status;
  assignment.status = "pending";
  assignment.updated_at = now;
  assignment.status_updated_at = now;
  assignment.claim = undefined;
  assignment.last_error = undefined;
  assignment.result = undefined;
  assignment.active_run_id = null;
  assignment.transitions = assignment.transitions ?? [];
  assignment.transitions.push({
    event: "manual_retry",
    from: previousStatus,
    to: "pending",
    at: now,
  });
  manager.save(assignment);
  return assignment;
}

function buildStatusView(workflow: WorkflowRecord): WorkflowStatusView {
  const manager = managerForWorkflow(workflow);
  const assignments = workflow.assignment_ids
    .map((assignmentId) => manager.load(assignmentId))
    .filter((assignment): assignment is AssignmentRecord => assignment !== null);
  return { workflow, assignments };
}

function getRevisionRequestPath(workflow: WorkflowRecord): string {
  return getWorkflowRevisionRequestPath(workflow.repo_path, workflow.id);
}

function clearRevisionRequest(workflow: WorkflowRecord): void {
  try {
    fs.unlinkSync(getRevisionRequestPath(workflow));
  } catch {}
}

function writeRevisionRequest(workflow: WorkflowRecord, feedback: string): string {
  const filePath = getRevisionRequestPath(workflow);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      "# Revision Request",
      "",
      "The previous research pass was reviewed and needs revision before approval.",
      "",
      "## Feedback",
      feedback,
      "",
      "Update the research brief to address this feedback directly.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return filePath;
}

async function dispatchPendingAssignment(
  workflow: WorkflowRecord,
  assignment: AssignmentRecord,
  dependencies: WorkflowDependencies | undefined,
): Promise<{ status: "dispatched" | "skipped" | "failed"; failure?: WorkflowFailure }> {
  const now = nowFn(dependencies);
  const manager = managerForWorkflow(workflow);
  const stateMachine = new AssignmentStateMachine(manager, { now });
  const dispatchCreateOnly = dispatchFn(dependencies);
  const destroyTerminal = destroyTerminalFn(dependencies);
  const tickId = `tick:${workflow.id}:${now()}`;
  const runId = generateRunId();
  const claim = await stateMachine.claimPending(assignment.id, tickId);
  if (!claim.changed) {
    return { status: "skipped" };
  }

  const assignmentsById = buildAssignmentsMap(manager, workflow);
  const freshAssignment = assignmentsById.get(assignment.id) ?? loadAssignmentByIdOrThrow(manager, workflow, assignment.id);
  const taskSpec = buildAssignmentTaskSpec({
    workflow,
    assignment: freshAssignment,
    assignmentsById,
    runId,
  });

  let dispatchedTerminalId: string | undefined;
  try {
    const runArtifacts = writeRunTask(taskSpec);
    const dispatch = await dispatchCreateOnly(buildDispatchRequest(workflow, freshAssignment, runId));
    dispatchedTerminalId = dispatch.terminalId;
    registerDispatchAttempt(manager, assignment.id, {
      runId,
      terminalId: dispatch.terminalId,
      agentType: dispatch.terminalType as AgentType,
      prompt: dispatch.prompt,
      taskFile: runArtifacts.task_file,
      resultFile: runArtifacts.result_file,
      artifactDir: runArtifacts.artifact_dir,
      startedAt: now(),
    });
    await stateMachine.markInProgress(assignment.id, { tickId, runId });
    return { status: "dispatched" };
  } catch (error) {
    if (dispatchedTerminalId) {
      try {
        destroyTerminal(dispatchedTerminalId);
      } catch {}
    }
    const failure = buildAssignmentFailure(
      "ASSIGNMENT_DISPATCH_FAILED",
      error instanceof Error ? error.message : String(error),
      "workflow.dispatch_assignment",
    );
    try {
      await stateMachine.markFailed(assignment.id, failure);
    } catch {}
    return { status: "failed", failure };
  }
}

function resolveChallengeStage(
  workflow: WorkflowRecord,
  assignment: AssignmentRecord,
): ChallengeStage {
  if (
    workflow.template === "researcher-implementer-tester" &&
    assignment.id === workflow.assignment_ids[0] &&
    assignment.kind === "intent_confirmation"
  ) {
    return "intent_confirmation";
  }

  if (assignment.id === workflow.assignment_ids[0]) return "researcher";
  if (assignment.id === workflow.assignment_ids[1]) return "implementer";
  return "tester";
}

function buildChallengeReturnTargets(
  workflow: WorkflowRecord,
  assignment: AssignmentRecord,
): ChallengeReturnTarget[] {
  const [researcherId, implementerId, testerId] = getFullWorkflowAssignmentIds(workflow);
  const stage = resolveChallengeStage(workflow, assignment);

  if (stage === "researcher") {
    return [
      {
        role: "researcher",
        assignment_id: researcherId,
        requeue_assignment_ids: [researcherId],
        mode: "reuse",
        description: "Rerun the research pass before approval.",
      },
    ];
  }

  if (stage === "implementer") {
    return [
      {
        role: "implementer",
        assignment_id: implementerId,
        requeue_assignment_ids: [implementerId, testerId],
        mode: "reuse",
        description: "Send the work back to implementation and re-verification.",
      },
      {
        role: "researcher",
        assignment_id: researcherId,
        requeue_assignment_ids: [researcherId, implementerId],
        mode: "replan",
        description: "Escalate to a new research/replan pass before implementation continues.",
      },
    ];
  }

  if (stage === "tester") {
    return [
      {
        role: "tester",
        assignment_id: testerId,
        requeue_assignment_ids: [testerId],
        mode: "reuse",
        description: "Rerun verification with the challenge findings in mind.",
      },
      {
        role: "implementer",
        assignment_id: implementerId,
        requeue_assignment_ids: [implementerId, testerId],
        mode: "reuse",
        description: "Send the work back to implementation and re-verification.",
      },
    ];
  }

  return [
    {
      role: "implementer",
      assignment_id: implementerId,
      requeue_assignment_ids: [implementerId, testerId],
      mode: "reuse",
      description: "Send the workflow back to implementation under the existing approved research.",
    },
    {
      role: "researcher",
      assignment_id: researcherId,
      requeue_assignment_ids: [researcherId, implementerId, testerId],
      mode: "replan",
      description: "Escalate to a new research/replan pass before the workflow can complete.",
    },
  ];
}

function labelledExistingFiles(entries: ChallengeContextFile[]): ChallengeContextFile[] {
  return entries.filter((entry) => fs.existsSync(entry.path));
}

function buildChallengeContextFiles(
  workflow: WorkflowRecord,
  manager: AssignmentManager,
  assignment: AssignmentRecord,
): ChallengeContextFile[] {
  const [researcherId, implementerId, testerId] = getFullWorkflowAssignmentIds(workflow);
  const researcher = loadAssignmentByIdOrThrow(manager, workflow, researcherId);
  const implementer = loadAssignmentByIdOrThrow(manager, workflow, implementerId);
  const tester = loadAssignmentByIdOrThrow(manager, workflow, testerId);
  const stage = resolveChallengeStage(workflow, assignment);
  const approved = workflow.approved_refs?.research;
  const researcherRun = latestRun(researcher);
  const implementerRun = latestRun(implementer);
  const testerRun = latestRun(tester);

  if (stage === "researcher") {
    return labelledExistingFiles([
      ...(researcherRun ? [
        { label: "Research result", path: researcherRun.result_file },
        { label: "Research brief", path: getRunBriefFile(workflow.repo_path, workflow.id, researcher.id, researcherRun.id) },
        { label: "Approval request", path: getRunApprovalRequestFile(workflow.repo_path, workflow.id, researcher.id, researcherRun.id) },
      ] : []),
    ]);
  }

  if (stage === "implementer") {
    return labelledExistingFiles([
      ...(approved ? [
        { label: "Approved research result", path: approved.result_file },
        { label: "Approved research brief", path: approved.brief_file },
      ] : []),
      ...(implementerRun ? [
        { label: "Implementation result", path: implementerRun.result_file },
        { label: "Implementation brief", path: getRunBriefFile(workflow.repo_path, workflow.id, implementer.id, implementerRun.id) },
      ] : []),
    ]);
  }

  if (stage === "tester") {
    return labelledExistingFiles([
      ...(approved ? [
        { label: "Approved research result", path: approved.result_file },
        { label: "Approved research brief", path: approved.brief_file },
      ] : []),
      ...(implementerRun ? [
        { label: "Implementation result", path: implementerRun.result_file },
        { label: "Implementation brief", path: getRunBriefFile(workflow.repo_path, workflow.id, implementer.id, implementerRun.id) },
      ] : []),
      ...(testerRun ? [
        { label: "Verification result", path: testerRun.result_file },
        { label: "Verification brief", path: getRunBriefFile(workflow.repo_path, workflow.id, tester.id, testerRun.id) },
      ] : []),
    ]);
  }

  return labelledExistingFiles([
    ...(approved ? [
      { label: "Approved research result", path: approved.result_file },
      { label: "Approved research brief", path: approved.brief_file },
    ] : []),
    ...(implementerRun ? [
      { label: "Implementation result", path: implementerRun.result_file },
      { label: "Implementation brief", path: getRunBriefFile(workflow.repo_path, workflow.id, implementer.id, implementerRun.id) },
    ] : []),
    ...(testerRun ? [
      { label: "Verification result", path: testerRun.result_file },
      { label: "Verification brief", path: getRunBriefFile(workflow.repo_path, workflow.id, tester.id, testerRun.id) },
    ] : []),
    ...(researcherRun ? [
      { label: "Intent confirmation result", path: researcherRun.result_file },
    ] : []),
  ]);
}

function buildChallengeReportPath(workflow: WorkflowRecord): string {
  return path.join(path.resolve(workflow.repo_path), ".hydra", "workflows", workflow.id, "challenge-report.md");
}

function toChallengeContinueTarget(decision: TemplateAdvanceDecision): ChallengeContinueTarget {
  if (decision.outcome === "fail") {
    throw new HydraError("Cannot convert a failed template decision into a continue target", {
      errorCode: "WORKFLOW_INVALID_CHALLENGE_CONTINUE",
      stage: "workflow.challenge_continue",
      ids: {},
    });
  }

  return {
    outcome: decision.outcome,
    next_assignment_id: decision.nextAssignmentId,
    requeue_assignment_ids: decision.requeueAssignmentIds,
  };
}

function writeChallengeDecisionReport(
  workflow: WorkflowRecord,
  challenge: NonNullable<WorkflowRecord["challenge"]>,
  decision: ChallengeDecision,
  at: string,
): string {
  const reportPath = buildChallengeReportPath(workflow);
  const findings = decision?.findings ?? [];
  const continueTarget =
    challenge.continue_target.outcome === "complete"
      ? "complete the workflow"
      : challenge.continue_target.outcome === "await_approval"
        ? "return to the approval gate"
        : `continue with ${challenge.continue_target.next_assignment_id ?? "the proposed next assignment"}`;

  const lines = [
    "# Challenge Report",
    "",
    `Completed At: ${at}`,
    `Source Stage: ${challenge.source_stage}`,
    `Source Assignment: ${challenge.source_assignment_id}`,
    "",
    "## Summary",
    "",
    decision?.summary ?? "Challenge completed.",
    "",
    "## Proposed Continue Path",
    "",
    `- ${continueTarget}`,
    "",
    "## Available Send-Back Targets",
    "",
    ...challenge.return_targets.map((target) => `- ${target.role}: ${target.description}`),
    "",
    "## Findings",
    "",
    ...(findings.length === 0
      ? ["- No significant findings."]
      : findings.map((finding) => `- [${finding.severity}] ${finding.point}: ${finding.reasoning}`)),
  ];

  fs.writeFileSync(reportPath, lines.join("\n"), "utf-8");
  return reportPath;
}

async function startChallengeForBoundary(
  workflow: WorkflowRecord,
  manager: AssignmentManager,
  assignment: AssignmentRecord,
  continueDecision: TemplateAdvanceDecision,
  dependencies: WorkflowDependencies | undefined,
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies)();
  const stage = resolveChallengeStage(workflow, assignment);
  const contextFiles = buildChallengeContextFiles(workflow, manager, assignment);
  const workers = await spawnChallengeWorkers(
    {
      workflowId: workflow.id,
      repoPath: workflow.repo_path,
      worktreePath: workflow.worktree_path,
      stage,
      contextFiles,
      autoApprove: workflow.auto_approve,
      agentType: assignment.requested_agent_type,
      parentTerminalId:
        workflow.parent_terminal_id ?? process.env.TERMCANVAS_TERMINAL_ID,
    },
    dispatchFn(dependencies),
  );

  workflow.challenge_request = undefined;
  workflow.challenge = {
    workers,
    started_at: now,
    source_assignment_id: assignment.id,
    source_stage: stage,
    continue_target: toChallengeContinueTarget(continueDecision),
    return_targets: buildChallengeReturnTargets(workflow, assignment),
    context_files: contextFiles,
  };
  workflow.status = "challenging";
  workflow.failure = undefined;
  workflow.updated_at = now;
  saveWorkflow(workflow);
  return buildStatusView(workflow);
}

function prepareResearcherIntentConfirmation(
  workflow: WorkflowRecord,
  manager: AssignmentManager,
): AssignmentRecord {
  const [researcherId] = getFullWorkflowAssignmentIds(workflow);
  const researcher = loadAssignmentByIdOrThrow(manager, workflow, researcherId);
  researcher.kind = "intent_confirmation";
  researcher.updated_at = new Date().toISOString();
  manager.save(researcher);
  return researcher;
}

function prepareResearcherReplan(
  workflow: WorkflowRecord,
  manager: AssignmentManager,
): AssignmentRecord {
  const [researcherId] = getFullWorkflowAssignmentIds(workflow);
  const researcher = loadAssignmentByIdOrThrow(manager, workflow, researcherId);
  researcher.kind = "research_replan";
  researcher.updated_at = new Date().toISOString();
  manager.save(researcher);
  return researcher;
}

async function applyContinueDecision(
  workflow: WorkflowRecord,
  manager: AssignmentManager,
  continueTarget: ChallengeContinueTarget,
  dependencies: WorkflowDependencies | undefined,
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);

  if (continueTarget.outcome === "await_approval") {
    workflow.status = "waiting_for_approval";
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  if (continueTarget.outcome === "complete") {
    workflow.status = "completed";
    workflow.failure = undefined;
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  if (
    continueTarget.outcome === "intent_confirmation"
    && continueTarget.next_assignment_id
    && continueTarget.requeue_assignment_ids
  ) {
    const nextIteration = (workflow.confirmation_iteration ?? 0) + 1;
    const maxIterations = workflow.max_confirmation_iterations ?? DEFAULT_MAX_CONFIRMATION_ITERATIONS;
    if (nextIteration > maxIterations) {
      saveWorkflowFailure(
        workflow,
        {
          code: "WORKFLOW_MAX_CONFIRMATION_ITERATIONS_REACHED",
          message: `Researcher intent confirmation exceeded the iteration cap (${maxIterations}).`,
          stage: "workflow.intent_confirmation",
        },
        now(),
      );
      return buildStatusView(workflow);
    }

    for (const assignmentId of continueTarget.requeue_assignment_ids) {
      const requeueAssignment = manager.load(assignmentId);
      if (requeueAssignment) destroyAssignmentTerminal(requeueAssignment, dependencies);
      resetAssignmentToPending(manager, assignmentId, now());
    }
    prepareResearcherIntentConfirmation(workflow, manager);

    workflow.current_assignment_id = continueTarget.next_assignment_id;
    workflow.status = "running";
    workflow.failure = undefined;
    workflow.result = undefined;
    workflow.confirmation_iteration = nextIteration;
    workflow.updated_at = now();
    saveWorkflow(workflow);
    const nextAssignment = loadAssignmentOrThrow(manager, workflow);
    await dispatchPendingAssignment(workflow, nextAssignment, dependencies);
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  if (continueTarget.outcome === "advance" && continueTarget.next_assignment_id) {
    workflow.current_assignment_id = continueTarget.next_assignment_id;
    workflow.status = "running";
    workflow.failure = undefined;
    workflow.updated_at = now();
    saveWorkflow(workflow);
    const nextAssignment = loadAssignmentOrThrow(manager, workflow);
    await dispatchPendingAssignment(workflow, nextAssignment, dependencies);
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  if (
    continueTarget.outcome === "loop"
    && continueTarget.next_assignment_id
    && continueTarget.requeue_assignment_ids
  ) {
    for (const assignmentId of continueTarget.requeue_assignment_ids) {
      const requeueAssignment = manager.load(assignmentId);
      if (requeueAssignment) destroyAssignmentTerminal(requeueAssignment, dependencies);
      resetAssignmentToPending(manager, assignmentId, now());
    }
    if (
      workflow.template === "researcher-implementer-tester"
      && continueTarget.next_assignment_id === workflow.assignment_ids[0]
    ) {
      prepareResearcherReplan(workflow, manager);
      workflow.confirmation_iteration = 0;
    }
    workflow.current_assignment_id = continueTarget.next_assignment_id;
    workflow.status = "running";
    workflow.failure = undefined;
    workflow.result = undefined;
    workflow.updated_at = now();
    saveWorkflow(workflow);
    const nextAssignment = loadAssignmentOrThrow(manager, workflow);
    await dispatchPendingAssignment(workflow, nextAssignment, dependencies);
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  saveWorkflowFailure(
    workflow,
    {
      code: "WORKFLOW_INVALID_CHALLENGE_CONTINUE",
      message: "Challenge continue target could not be applied.",
      stage: "workflow.challenge_continue",
    },
    now(),
  );
  return buildStatusView(workflow);
}

export async function runWorkflow(
  options: RunWorkflowOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);
  const repoPath = path.resolve(options.repoPath);
  const workflowId = generateWorkflowId();
  const template = options.template ?? "researcher-implementer-tester";
  const baseType = options.agentType ?? resolveDefaultAgentType();
  const implementerType = options.implementerType ?? baseType;
  const researcherType = options.researcherType ?? baseType;
  const testerType = options.testerType ?? baseType;

  if (options.autoApprove) {
    for (const agentType of [researcherType, implementerType, testerType]) {
      if (!AUTO_APPROVE_AGENT_TYPES.has(agentType)) {
        throw new HydraError(
          `Agent type "${agentType}" does not support auto-approve. Only ${[...AUTO_APPROVE_AGENT_TYPES].join(", ")} support it. Use --no-auto-approve or switch to a supported agent type.`,
          {
            errorCode: "AGENT_AUTO_APPROVE_UNSUPPORTED",
            stage: "workflow.preflight",
            ids: { workflow_id: workflowId },
          },
        );
      }
    }
  }

  const plannedAssignmentIds = template === "single-step"
    ? [generateAssignmentId()]
    : [generateAssignmentId(), generateAssignmentId(), generateAssignmentId()];
  const workspace = prepareWorkflowWorkspace(
    repoPath,
    workflowId,
    options.worktreePath,
    dependencies,
  );
  writeWorkflowUserRequest(repoPath, workflowId, options.task);
  const plan = buildWorkflowTemplatePlan({
    template,
    workflowId,
    task: options.task,
    researcherAgentType: researcherType,
    implementerAgentType: implementerType,
    testerAgentType: testerType,
    repoPath,
    assignmentIds: plannedAssignmentIds,
  });
  const manager = new AssignmentManager(repoPath, workflowId);
  const createdAssignments = plan.assignments.map((assignmentPlan) => manager.create({
    id: assignmentPlan.id,
    workflow_id: workflowId,
    workspace_root: repoPath,
    worktree_path: workspace.worktreePath,
    role: assignmentPlan.role,
    kind: assignmentPlan.kind,
    from_assignment_id: assignmentPlan.from_assignment_id,
    requested_agent_type: assignmentPlan.requested_agent_type,
    timeout_minutes: options.timeoutMinutes,
    max_retries: options.maxRetries,
  }));

  const workflow: WorkflowRecord = {
    schema_version: WORKFLOW_STATE_SCHEMA_VERSION,
    id: workflowId,
    template,
    task: options.task,
    repo_path: repoPath,
    worktree_path: workspace.worktreePath,
    branch: workspace.branch,
    base_branch: workspace.baseBranch,
    own_worktree: workspace.ownWorktree,
    parent_terminal_id: process.env.TERMCANVAS_TERMINAL_ID,
    created_at: now(),
    updated_at: now(),
    status: "pending",
    current_assignment_id: plan.startAssignmentId,
    assignment_ids: createdAssignments.map((assignment) => assignment.id),
    timeout_minutes: options.timeoutMinutes,
    max_retries: options.maxRetries,
    confirmation_iteration: 0,
    max_confirmation_iterations: DEFAULT_MAX_CONFIRMATION_ITERATIONS,
    auto_approve: options.autoApprove,
  };
  saveWorkflow(workflow);

  return tickWorkflow(
    {
      repoPath,
      workflowId,
    },
    dependencies,
  );
}

export async function tickWorkflow(
  options: TickWorkflowOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  const manager = managerForWorkflow(workflow);
  const stateMachine = new AssignmentStateMachine(manager, { now });
  const assignment = loadAssignmentOrThrow(manager, workflow);

  if (
    workflow.status === "waiting_for_approval"
    || workflow.status === "waiting_for_challenge_decision"
  ) {
    return buildStatusView(workflow);
  }

  if (workflow.status === "challenging" && workflow.challenge) {
    const challengeResult = collectChallengeResults(workflow.challenge);
    if (challengeResult.status === "pending") {
      return buildStatusView(workflow);
    }

    if (challengeResult.status === "invalid") {
      destroyChallengeTerminals(
        workflow.challenge,
        destroyTerminalFn(dependencies),
      );
      workflow.challenge = {
        ...workflow.challenge,
        completed_at: now(),
      };
      saveWorkflowFailure(workflow, challengeResult.failure, now());
      return buildStatusView(workflow);
    }

    const challengeDecision = challengeResult.decision;

    destroyChallengeTerminals(
      workflow.challenge,
      destroyTerminalFn(dependencies),
    );
    const completedAt = now();
    const reportFile = writeChallengeDecisionReport(
      workflow,
      workflow.challenge,
      challengeDecision,
      completedAt,
    );
    workflow.challenge = {
      ...workflow.challenge,
      decision: challengeDecision,
      report_file: reportFile,
      completed_at: completedAt,
    };
    workflow.status = "waiting_for_challenge_decision";
    workflow.failure = undefined;
    workflow.updated_at = completedAt;
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  if (assignment.status === "pending") {
    const dispatchOutcome = await dispatchPendingAssignment(workflow, assignment, dependencies);
    if (dispatchOutcome.status === "failed") {
      saveWorkflowFailure(
        workflow,
        dispatchOutcome.failure ?? buildAssignmentFailure(
          "ASSIGNMENT_DISPATCH_FAILED",
          `Failed to dispatch assignment ${assignment.id}`,
          "workflow.dispatch_assignment",
        ),
        now(),
      );
      return buildStatusView(workflow);
    }
    if (dispatchOutcome.status === "skipped") {
      return buildStatusView(loadWorkflowOrThrow(repoPath, options.workflowId));
    }
    workflow.status = "running";
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  if (assignment.status === "claimed" || assignment.status === "in_progress") {
    const run = latestRun(assignment);
    if (!run) {
      const failure = buildAssignmentFailure(
        "WORKFLOW_RUN_MISSING",
        `Assignment ${assignment.id} is ${assignment.status} but has no registered run.`,
        "workflow.current_run",
      );
      await stateMachine.markFailed(assignment.id, failure);
      saveWorkflowFailure(workflow, failure, now());
      return buildStatusView(workflow);
    }
    const collected = collectRunResult({
      workflow_id: workflow.id,
      assignment_id: assignment.id,
      run_id: run.id,
      result_file: run.result_file,
    });

    if (collected.status === "completed") {
      const artifactFailure = validateRequiredWorkflowArtifacts(workflow, assignment, run.id);
      if (artifactFailure) {
        await stateMachine.markFailed(assignment.id, artifactFailure);
        saveWorkflowFailure(workflow, artifactFailure, now());
        return buildStatusView(workflow);
      }

      await stateMachine.markCompleted(assignment.id, mapWorkflowResult(collected.result));
      destroyAssignmentTerminal(assignment, dependencies);
      workflow.updated_at = now();
      const decision = resolveTemplateAdvance(
        workflow.template as WorkflowTemplateName,
        workflow.assignment_ids,
        assignment.id,
        collected.result,
        { currentKind: assignment.kind },
      );
      if (
        workflow.challenge_request?.source_assignment_id === assignment.id &&
        decision.outcome !== "fail"
      ) {
        if (decision.outcome === "complete") {
          workflow.result = collected.result;
        }
        return startChallengeForBoundary(
          workflow,
          manager,
          assignment,
          decision,
          dependencies,
        );
      }

      if (decision.outcome !== "fail") {
        if (decision.outcome === "complete") {
          workflow.result = collected.result;
        }
        return applyContinueDecision(
          workflow,
          manager,
          toChallengeContinueTarget(decision),
          dependencies,
        );
      }

      saveWorkflowFailure(
        workflow,
        decision.failure ?? {
          code: "WORKFLOW_TEMPLATE_FAILED",
          message: collected.result.summary,
          stage: "workflow.template",
        },
        now(),
      );
      return buildStatusView(workflow);
    }

    if (collected.status === "failed") {
      await stateMachine.markFailed(assignment.id, collected.failure);
      saveWorkflowFailure(workflow, collected.failure, now());
      return buildStatusView(workflow);
    }

    const activeRun = currentRunOrThrow(loadAssignmentByIdOrThrow(manager, workflow, assignment.id));
    const alive = checkTerminalAliveFn(dependencies)(activeRun.terminal_id);
    if (alive === false) {
      const dispatchedMs = activeRun.started_at
        ? Date.parse(activeRun.started_at)
        : 0;
      const elapsedMs = Date.parse(now()) - dispatchedMs;
      if (elapsedMs > SPAWN_GRACE_PERIOD_MS) {
        destroyAssignmentTerminal(assignment, dependencies);
        await stateMachine.markTimedOut(assignment.id, {
          code: "ASSIGNMENT_PROCESS_EXITED",
          message: `Agent process exited without writing result (elapsed ${Math.round(elapsedMs / 1000)}s)`,
          stage: "workflow.telemetry_check",
        });
        const retryRunId = generateRunId();
        const retrySpec = buildAssignmentTaskSpec({
          workflow,
          assignment: loadAssignmentByIdOrThrow(manager, workflow, assignment.id),
          assignmentsById: buildAssignmentsMap(manager, workflow),
          runId: retryRunId,
        });
        const retryArtifacts = writeRunTask(retrySpec);
        const retryDecision = await stateMachine.scheduleRetry(assignment.id);
        workflow.updated_at = now();
        if (retryDecision.assignment.status === "failed") {
          saveWorkflowFailure(workflow, {
            code: "ASSIGNMENT_PROCESS_EXITED",
            message: "Agent process exited and retry limit reached",
            stage: "workflow.telemetry_check",
          }, now());
          return buildStatusView(workflow);
        }
        const retryTickId = `retry:${assignment.id}:${now()}`;
        const claim = await stateMachine.claimPending(assignment.id, retryTickId);
        if (!claim.changed) {
          return buildStatusView(loadWorkflowOrThrow(repoPath, options.workflowId));
        }
        let dispatchedTerminalId: string | undefined;
        try {
          const dispatch = await dispatchFn(dependencies)({
            ...buildDispatchRequest(workflow, retryDecision.assignment, retryRunId),
            taskFile: retryArtifacts.task_file,
            resultFile: retryArtifacts.result_file,
          });
          dispatchedTerminalId = dispatch.terminalId;
          registerDispatchAttempt(manager, assignment.id, {
            runId: retryRunId,
            terminalId: dispatch.terminalId,
            agentType: dispatch.terminalType as AgentType,
            prompt: dispatch.prompt,
            taskFile: retryArtifacts.task_file,
            resultFile: retryArtifacts.result_file,
            artifactDir: retryArtifacts.artifact_dir,
            startedAt: now(),
            retryOfRunId: activeRun.id,
          });
          await stateMachine.markInProgress(assignment.id, {
            tickId: retryTickId,
            runId: retryRunId,
          });
        } catch (error) {
          if (dispatchedTerminalId) {
            try {
              destroyTerminalFn(dependencies)(dispatchedTerminalId);
            } catch {}
          }
          const failure = buildAssignmentFailure(
            "ASSIGNMENT_RETRY_DISPATCH_FAILED",
            error instanceof Error ? error.message : String(error),
            "workflow.telemetry_retry_dispatch",
          );
          await stateMachine.markFailed(assignment.id, failure);
          saveWorkflowFailure(workflow, failure, now());
          return buildStatusView(workflow);
        }
        workflow.status = "running";
        workflow.failure = undefined;
        saveWorkflow(workflow);
        return buildStatusView(workflow);
      }
    }

    const assignmentForTimeout = loadAssignmentByIdOrThrow(manager, workflow, assignment.id);
    if (hasAssignmentTimedOut(assignmentForTimeout, now())) {
      const retryRunId = generateRunId();
      const retrySpec = buildAssignmentTaskSpec({
        workflow,
        assignment: assignmentForTimeout,
        assignmentsById: buildAssignmentsMap(manager, workflow),
        runId: retryRunId,
      });
      const retryArtifacts = writeRunTask(retrySpec);
      const retryOutcome = await retryTimedOutAssignment(
        {
          assignmentId: assignment.id,
          timeoutCheckedAt: now(),
          dispatchRequest: {
            ...buildDispatchRequest(workflow, assignmentForTimeout, retryRunId),
            taskFile: retryArtifacts.task_file,
            resultFile: retryArtifacts.result_file,
          },
          runId: retryRunId,
          taskFile: retryArtifacts.task_file,
          resultFile: retryArtifacts.result_file,
          artifactDir: retryArtifacts.artifact_dir,
        },
        {
          manager,
          stateMachine,
          dispatchCreateOnly: dispatchFn(dependencies),
          destroyTerminal: destroyTerminalFn(dependencies),
          now,
        },
      );

      workflow.updated_at = now();
      if (retryOutcome.status === "retried") {
        workflow.status = "running";
        workflow.failure = undefined;
        saveWorkflow(workflow);
        return buildStatusView(workflow);
      }

      if (retryOutcome.status === "failed") {
        const failedAssignment = loadAssignmentOrThrow(manager, workflow);
        saveWorkflowFailure(
          workflow,
          {
            code: failedAssignment.last_error?.code ?? "WORKFLOW_RETRY_FAILED",
            message: failedAssignment.last_error?.message ?? "Retry failed",
            stage: failedAssignment.last_error?.stage ?? "workflow.retry",
          },
          now(),
        );
        return buildStatusView(workflow);
      }
    }

    workflow.status = "running";
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  workflow.updated_at = now();
  if (assignment.status === "completed") {
    workflow.status = workflow.result?.success === false ? "failed" : "completed";
  } else if (assignment.status === "failed" || assignment.status === "timed_out") {
    workflow.status = "failed";
    if (assignment.last_error) {
      workflow.failure = {
        code: assignment.last_error.code,
        message: assignment.last_error.message,
        stage: assignment.last_error.stage,
      };
    }
  }
  saveWorkflow(workflow);
  return buildStatusView(workflow);
}

export async function watchWorkflow(
  options: WatchWorkflowOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);
  const sleep = sleepFn(dependencies);
  const startedAtMs = Date.parse(now());

  while (true) {
    const view = await tickWorkflow(
      {
        repoPath: options.repoPath,
        workflowId: options.workflowId,
      },
      dependencies,
    );
    if (
      view.workflow.status === "completed"
      || view.workflow.status === "failed"
      || view.workflow.status === "waiting_for_approval"
      || view.workflow.status === "waiting_for_challenge_decision"
    ) {
      return view;
    }

    const elapsedMs = Date.parse(now()) - startedAtMs;
    if (options.timeoutMs !== undefined && elapsedMs >= options.timeoutMs) {
      return view;
    }

    await sleep(options.intervalMs);
  }
}

export function getWorkflowStatus(options: TickWorkflowOptions): WorkflowStatusView {
  const workflow = loadWorkflowOrThrow(options.repoPath, options.workflowId);
  return buildStatusView(workflow);
}

export async function retryWorkflow(
  options: RetryWorkflowOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);
  const workflow = loadWorkflowOrThrow(options.repoPath, options.workflowId);
  const manager = managerForWorkflow(workflow);
  const assignment = loadAssignmentOrThrow(manager, workflow);
  resetFailedOrTimedOutAssignment(manager, workflow, assignment, now());
  workflow.status = "pending";
  workflow.failure = undefined;
  workflow.result = undefined;
  workflow.updated_at = now();
  saveWorkflow(workflow);
  return tickWorkflow(
    {
      repoPath: workflow.repo_path,
      workflowId: workflow.id,
    },
    dependencies,
  );
}

export interface ApproveWorkflowOptions extends TickWorkflowOptions {}

export interface ReviseWorkflowOptions extends TickWorkflowOptions {
  feedback: string;
}

export async function requestWorkflowChallenge(
  options: RequestWorkflowChallengeOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  const manager = managerForWorkflow(workflow);

  if (workflow.challenge || workflow.status === "challenging" || workflow.status === "waiting_for_challenge_decision") {
    throw new HydraError("Workflow already has an active challenge run or pending challenge decision", {
      errorCode: "WORKFLOW_CHALLENGE_ALREADY_ACTIVE",
      stage: "workflow.challenge_request",
      ids: { workflow_id: workflow.id },
    });
  }

  if (workflow.template !== "researcher-implementer-tester") {
    throw new HydraError("Explicit challenge is currently only supported for full researcher/implementer/tester workflows", {
      errorCode: "WORKFLOW_CHALLENGE_UNSUPPORTED_TEMPLATE",
      stage: "workflow.challenge_request",
      ids: { workflow_id: workflow.id },
    });
  }

  if (workflow.status === "waiting_for_approval") {
    const assignment = loadAssignmentOrThrow(manager, workflow);
    return startChallengeForBoundary(
      workflow,
      manager,
      assignment,
      { outcome: "await_approval" },
      dependencies,
    );
  }

  if (workflow.status !== "running" && workflow.status !== "pending") {
    throw new HydraError(`Workflow is not in a challengeable state: ${workflow.status}`, {
      errorCode: "WORKFLOW_CHALLENGE_INVALID_STATE",
      stage: "workflow.challenge_request",
      ids: { workflow_id: workflow.id },
    });
  }

  workflow.challenge_request = {
    source_assignment_id: workflow.current_assignment_id,
    requested_at: now(),
  };
  workflow.updated_at = now();
  saveWorkflow(workflow);
  return buildStatusView(workflow);
}

export async function resolveWorkflowChallenge(
  options: ResolveWorkflowChallengeOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  const manager = managerForWorkflow(workflow);

  if (workflow.status !== "waiting_for_challenge_decision" || !workflow.challenge?.decision) {
    throw new HydraError("Workflow is not waiting for a challenge decision", {
      errorCode: "WORKFLOW_NOT_AWAITING_CHALLENGE_DECISION",
      stage: "workflow.challenge_resolve",
      ids: { workflow_id: workflow.id },
    });
  }

  const challenge = workflow.challenge;
  workflow.challenge = undefined;
  workflow.updated_at = now();

  if (options.decision === "continue") {
    saveWorkflow(workflow);
    return applyContinueDecision(
      workflow,
      manager,
      challenge.continue_target,
      dependencies,
    );
  }

  const targetRole = options.to;
  if (!targetRole) {
    throw new HydraError("Missing challenge send-back target", {
      errorCode: "WORKFLOW_CHALLENGE_TARGET_REQUIRED",
      stage: "workflow.challenge_resolve",
      ids: { workflow_id: workflow.id },
    });
  }

  const target = challenge.return_targets.find((entry) => entry.role === targetRole);
  if (!target) {
    throw new HydraError(`Challenge cannot send back to ${targetRole} from this stage`, {
      errorCode: "WORKFLOW_CHALLENGE_INVALID_TARGET",
      stage: "workflow.challenge_resolve",
      ids: { workflow_id: workflow.id },
    });
  }

  for (const assignmentId of target.requeue_assignment_ids) {
    const requeueAssignment = manager.load(assignmentId);
    if (requeueAssignment) destroyAssignmentTerminal(requeueAssignment, dependencies);
    resetAssignmentToPending(manager, assignmentId, now());
  }

  if (target.mode === "replan" && target.role === "researcher") {
    prepareResearcherReplan(workflow, manager);
    workflow.confirmation_iteration = 0;
  }

  workflow.current_assignment_id = target.assignment_id;
  workflow.status = "running";
  workflow.failure = undefined;
  workflow.result = undefined;
  workflow.updated_at = now();
  saveWorkflow(workflow);

  const nextAssignment = loadAssignmentOrThrow(manager, workflow);
  await dispatchPendingAssignment(workflow, nextAssignment, dependencies);
  workflow.updated_at = now();
  saveWorkflow(workflow);
  return buildStatusView(workflow);
}

export async function approveWorkflow(
  options: ApproveWorkflowOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);

  if (workflow.status !== "waiting_for_approval") {
    throw new HydraError(`Workflow is not waiting for approval (status: ${workflow.status})`, {
      errorCode: "WORKFLOW_NOT_AWAITING_APPROVAL",
      stage: "workflow.approve",
      ids: { workflow_id: workflow.id },
    });
  }

  const manager = managerForWorkflow(workflow);
  const researcherId = workflow.assignment_ids[0];
  const researcher = loadAssignmentByIdOrThrow(manager, workflow, researcherId);
  persistApprovedResearchRef(workflow, researcher, now());
  clearRevisionRequest(workflow);
  const implementerId = workflow.assignment_ids[1];
  workflow.current_assignment_id = implementerId;
  workflow.status = "running";
  workflow.updated_at = now();
  saveWorkflow(workflow);

  const nextAssignment = loadAssignmentOrThrow(manager, workflow);
  await dispatchPendingAssignment(workflow, nextAssignment, dependencies);
  workflow.updated_at = now();
  saveWorkflow(workflow);
  return buildStatusView(workflow);
}

export async function reviseWorkflow(
  options: ReviseWorkflowOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);

  if (workflow.status !== "waiting_for_approval") {
    throw new HydraError(`Workflow is not waiting for approval (status: ${workflow.status})`, {
      errorCode: "WORKFLOW_NOT_AWAITING_APPROVAL",
      stage: "workflow.revise",
      ids: { workflow_id: workflow.id },
    });
  }

  const manager = managerForWorkflow(workflow);
  const researcherId = workflow.assignment_ids[0];
  const researcher = loadAssignmentByIdOrThrow(manager, workflow, researcherId);
  writeRevisionRequest(workflow, options.feedback);
  researcher.kind = "research";
  manager.save(researcher);
  resetAssignmentToPending(manager, researcherId, now());
  workflow.current_assignment_id = researcherId;
  workflow.status = "running";
  workflow.failure = undefined;
  workflow.result = undefined;
  workflow.updated_at = now();
  saveWorkflow(workflow);

  return tickWorkflow(
    { repoPath, workflowId: workflow.id },
    dependencies,
  );
}

export function cleanupWorkflowState(repoPath: string, workflowId: string): void {
  deleteWorkflow(repoPath, workflowId);
}
