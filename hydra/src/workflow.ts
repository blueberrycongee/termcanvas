import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { collectTaskPackage } from "./collector.ts";
import {
  dispatchCreateOnly as defaultDispatchCreateOnly,
  type DispatchCreateOnlyRequest,
  type DispatchCreateOnlyResult,
} from "./dispatcher.ts";
import { HydraError } from "./errors.ts";
import { HandoffManager } from "./handoff/manager.ts";
import { HandoffStateMachine } from "./handoff/state-machine.ts";
import type { Handoff, AgentType } from "./handoff/types.ts";
import { AUTO_APPROVE_AGENT_TYPES, resolveDefaultAgentType } from "./agent-selection.ts";
import { validateHandoffContract, type ResultContract } from "./protocol.ts";
import { registerDispatchAttempt, retryTimedOutHandoff } from "./retry.ts";
import { buildTaskPackageContext, writeTaskPackage } from "./task-package.ts";
import {
  approvalRequestFile,
  approvedResearchBriefFile,
  approvedResearchResultFile,
  buildWorkflowTemplatePlan,
  implementationBriefFile,
  researchBriefFile,
  resolveTemplateAdvance,
  verificationBriefFile,
  type TemplateAdvanceDecision,
  type WorkflowTemplateName,
} from "./workflow-template.ts";
import {
  spawnChallengeWorkers,
  collectChallengeResults,
  destroyChallengeTerminals,
  type ChallengeContextFile,
  type ChallengeContinueTarget,
  type ChallengeReturnTarget,
  type ChallengeStage,
  type ChallengeState,
} from "./challenge.ts";
import {
  deleteWorkflow,
  getWorkflowDir,
  loadWorkflow,
  saveWorkflow,
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

const SPAWN_GRACE_PERIOD_MS = 15_000;
const DEFAULT_MAX_CONFIRMATION_ITERATIONS = 3;

export interface RunWorkflowOptions {
  task: string;
  repoPath: string;
  worktreePath?: string;
  template?: WorkflowTemplateName;
  plannerType?: AgentType;
  implementerType?: AgentType;
  agentType?: AgentType;
  evaluatorType?: AgentType;
  timeoutMinutes: number;
  maxRetries: number;
  autoApprove: boolean;
  approvePlan?: boolean;
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
  handoffs: Handoff[];
}

export interface WorkflowDependencies {
  now?: () => string;
  dispatchCreateOnly?: (request: DispatchCreateOnlyRequest) => Promise<DispatchCreateOnlyResult>;
  sleep?: (ms: number) => Promise<void>;
  syncProject?: (repoPath: string) => void;
  destroyTerminal?: (terminalId: string) => void;
  /** Returns true if the terminal PTY is alive, false if dead, null if unknown/unavailable. */
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

function generateHandoffId(): string {
  return `handoff-${crypto.randomBytes(6).toString("hex")}`;
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

function loadContract(handoff: Handoff) {
  if (!handoff.artifacts) {
    throw new HydraError(`Handoff ${handoff.id} is missing artifacts`, {
      errorCode: "WORKFLOW_HANDOFF_MISSING_ARTIFACTS",
      stage: "workflow.load_contract",
      ids: {
        workflow_id: handoff.workflow_id,
        handoff_id: handoff.id,
      },
    });
  }

  return validateHandoffContract(
    JSON.parse(fs.readFileSync(handoff.artifacts.handoff_file, "utf-8")),
  );
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

function loadHandoffOrThrow(manager: HandoffManager, workflow: WorkflowRecord): Handoff {
  const handoff = manager.load(workflow.current_handoff_id);
  if (!handoff) {
    throw new HydraError(`Handoff not found: ${workflow.current_handoff_id}`, {
      errorCode: "WORKFLOW_HANDOFF_NOT_FOUND",
      stage: "workflow.load_handoff",
      ids: {
        workflow_id: workflow.id,
        handoff_id: workflow.current_handoff_id,
      },
    });
  }
  return handoff;
}

function getPieHandoffIds(workflow: WorkflowRecord): [string, string, string] {
  if (workflow.template !== "planner-implementer-evaluator" || workflow.handoff_ids.length !== 3) {
    throw new HydraError(`Workflow ${workflow.id} is not a planner-implementer-evaluator workflow`, {
      errorCode: "WORKFLOW_TEMPLATE_INVALID",
      stage: "workflow.template_state",
      ids: { workflow_id: workflow.id },
    });
  }
  return workflow.handoff_ids as [string, string, string];
}

function loadHandoffByIdOrThrow(
  manager: HandoffManager,
  workflow: WorkflowRecord,
  handoffId: string,
): Handoff {
  const handoff = manager.load(handoffId);
  if (!handoff) {
    throw new HydraError(`Handoff not found: ${handoffId}`, {
      errorCode: "WORKFLOW_HANDOFF_NOT_FOUND",
      stage: "workflow.load_handoff",
      ids: {
        workflow_id: workflow.id,
        handoff_id: handoffId,
      },
    });
  }
  return handoff;
}

function buildPieTemplatePlan(workflow: WorkflowRecord, manager: HandoffManager) {
  const [plannerId, implementerId, evaluatorId] = getPieHandoffIds(workflow);
  const plannerHandoff = loadHandoffByIdOrThrow(manager, workflow, plannerId);
  const implementerHandoff = loadHandoffByIdOrThrow(manager, workflow, implementerId);
  const evaluatorHandoff = loadHandoffByIdOrThrow(manager, workflow, evaluatorId);

  return buildWorkflowTemplatePlan({
    template: "planner-implementer-evaluator",
    workflowId: workflow.id,
    task: workflow.task,
    plannerAgentType: plannerHandoff.to.agent_type as AgentType,
    implementerAgentType: implementerHandoff.to.agent_type as AgentType,
    evaluatorAgentType: evaluatorHandoff.to.agent_type as AgentType,
    repoPath: workflow.repo_path,
    handoffIds: workflow.handoff_ids,
  });
}

function destroyHandoffTerminal(
  handoff: Handoff,
  dependencies: WorkflowDependencies | undefined,
): void {
  const terminalId = handoff.dispatch?.active_terminal_id;
  if (!terminalId) return;
  try {
    destroyTerminalFn(dependencies)(terminalId);
  } catch {
    // Terminal may already be dead — that's fine.
  }
}

function buildDispatchRequestFromHandoff(
  workflow: WorkflowRecord,
  handoff: Handoff,
): DispatchCreateOnlyRequest {
  if (!handoff.artifacts || !handoff.worktree_path) {
    throw new HydraError(`Handoff ${handoff.id} is missing dispatch metadata`, {
      errorCode: "WORKFLOW_HANDOFF_MISSING_DISPATCH_METADATA",
      stage: "workflow.dispatch_request",
      ids: {
        workflow_id: workflow.id,
        handoff_id: handoff.id,
      },
    });
  }

  return {
    workflowId: workflow.id,
    handoffId: handoff.id,
    repoPath: workflow.repo_path,
    worktreePath: handoff.worktree_path,
    agentType: handoff.to.agent_type,
    taskFile: handoff.artifacts.task_file,
    doneFile: handoff.artifacts.done_file,
    resultFile: handoff.artifacts.result_file,
    autoApprove: workflow.auto_approve,
    parentTerminalId:
      workflow.parent_terminal_id ?? process.env.TERMCANVAS_TERMINAL_ID,
  };
}

function mapResultContract(result: ResultContract): NonNullable<Handoff["result"]> {
  return {
    success: result.success,
    summary: result.summary,
    outputs: result.outputs,
    evidence: result.evidence,
    verification: result.verification,
    satisfaction: result.satisfaction,
    replan: result.replan,
    next_action: result.next_action,
    message: result.summary,
    output_files: result.outputs.map((output) => output.path),
  };
}

function rewriteHandoffTaskPackage(
  workflow: WorkflowRecord,
  handoff: Handoff,
): Handoff {
  if (!handoff.artifacts) {
    throw new HydraError(`Handoff ${handoff.id} is missing artifacts`, {
      errorCode: "WORKFLOW_HANDOFF_MISSING_ARTIFACTS",
      stage: "workflow.write_task_package",
      ids: {
        workflow_id: workflow.id,
        handoff_id: handoff.id,
      },
    });
  }

  const taskPackage = buildTaskPackageContext({
    workspaceRoot: workflow.repo_path,
    workflowId: workflow.id,
    handoffId: handoff.id,
    createdAt: handoff.created_at,
    from: handoff.from,
    to: handoff.to,
    task: handoff.task,
    context: handoff.context,
  });
  handoff.task = taskPackage.contract.task;
  handoff.context = taskPackage.contract.context;
  handoff.artifacts = writeTaskPackage(taskPackage.contract);
  return handoff;
}

function getApprovedResearchResultPath(workflow: WorkflowRecord): string {
  return approvedResearchResultFile(workflow.repo_path, workflow.id);
}

function getApprovedResearchBriefPath(workflow: WorkflowRecord): string {
  return approvedResearchBriefFile(workflow.repo_path, workflow.id);
}

function getResearchBriefPath(workflow: WorkflowRecord): string {
  const [researcherId] = getPieHandoffIds(workflow);
  return researchBriefFile(workflow.repo_path, workflow.id, researcherId);
}

function getApprovalRequestPath(workflow: WorkflowRecord): string {
  const [researcherId] = getPieHandoffIds(workflow);
  return approvalRequestFile(workflow.repo_path, workflow.id, researcherId);
}

function getImplementationBriefPath(workflow: WorkflowRecord): string {
  const [, implementerId] = getPieHandoffIds(workflow);
  return implementationBriefFile(workflow.repo_path, workflow.id, implementerId);
}

function getVerificationBriefPath(workflow: WorkflowRecord): string {
  const [, , testerId] = getPieHandoffIds(workflow);
  return verificationBriefFile(workflow.repo_path, workflow.id, testerId);
}

function persistApprovedResearchSnapshot(
  workflow: WorkflowRecord,
  researcherHandoff: Handoff,
): void {
  if (!researcherHandoff.artifacts) {
    throw new HydraError(`Researcher handoff ${researcherHandoff.id} is missing artifacts`, {
      errorCode: "WORKFLOW_HANDOFF_MISSING_ARTIFACTS",
      stage: "workflow.persist_approved_research",
      ids: {
        workflow_id: workflow.id,
        handoff_id: researcherHandoff.id,
      },
    });
  }

  fs.mkdirSync(getWorkflowDir(workflow.repo_path, workflow.id), { recursive: true });
  fs.copyFileSync(researcherHandoff.artifacts.result_file, getApprovedResearchResultPath(workflow));
  fs.copyFileSync(getResearchBriefPath(workflow), getApprovedResearchBriefPath(workflow));
}

function existingFiles(...files: string[]): string[] {
  return files.filter((filePath) => fs.existsSync(filePath));
}

function labelledExistingFiles(
  entries: ChallengeContextFile[],
): ChallengeContextFile[] {
  return entries.filter((entry) => fs.existsSync(entry.path));
}

function buildChallengeReportPath(workflow: WorkflowRecord): string {
  return path.join(getWorkflowDir(workflow.repo_path, workflow.id), "challenge-report.md");
}

function toChallengeContinueTarget(
  decision: TemplateAdvanceDecision,
): ChallengeContinueTarget {
  return {
    outcome: decision.outcome,
    next_handoff_id: decision.nextHandoffId,
    requeue_handoff_ids: decision.requeueHandoffIds,
  };
}

function resolveChallengeStage(
  workflow: WorkflowRecord,
  handoff: Handoff,
): ChallengeStage {
  if (
    workflow.template === "planner-implementer-evaluator" &&
    handoff.id === workflow.handoff_ids[0] &&
    handoff.task.type === "workflow-intent-confirmation"
  ) {
    return "intent_confirmation";
  }

  if (handoff.id === workflow.handoff_ids[0]) {
    return "researcher";
  }
  if (handoff.id === workflow.handoff_ids[1]) {
    return "implementer";
  }
  return "tester";
}

function buildChallengeReturnTargets(
  workflow: WorkflowRecord,
  handoff: Handoff,
): ChallengeReturnTarget[] {
  const [researcherId, implementerId, testerId] = getPieHandoffIds(workflow);
  const stage = resolveChallengeStage(workflow, handoff);

  if (stage === "researcher") {
    return [
      {
        role: "researcher",
        handoff_id: researcherId,
        requeue_handoff_ids: [researcherId],
        mode: "reuse",
        description: "Rerun the research pass before approval.",
      },
    ];
  }

  if (stage === "implementer") {
    return [
      {
        role: "implementer",
        handoff_id: implementerId,
        requeue_handoff_ids: [implementerId, testerId],
        mode: "reuse",
        description: "Send the work back to implementation and re-verification.",
      },
      {
        role: "researcher",
        handoff_id: researcherId,
        requeue_handoff_ids: [researcherId, implementerId],
        mode: "replan",
        description: "Escalate to a new research/replan pass before implementation continues.",
      },
    ];
  }

  if (stage === "tester") {
    return [
      {
        role: "tester",
        handoff_id: testerId,
        requeue_handoff_ids: [testerId],
        mode: "reuse",
        description: "Rerun verification with the challenge findings in mind.",
      },
      {
        role: "implementer",
        handoff_id: implementerId,
        requeue_handoff_ids: [implementerId, testerId],
        mode: "reuse",
        description: "Send the work back to implementation and re-verification.",
      },
    ];
  }

  return [
    {
      role: "implementer",
      handoff_id: implementerId,
      requeue_handoff_ids: [implementerId, testerId],
      mode: "reuse",
      description: "Send the workflow back to implementation under the existing approved research.",
    },
    {
      role: "researcher",
      handoff_id: researcherId,
      requeue_handoff_ids: [researcherId, implementerId, testerId],
      mode: "replan",
      description: "Escalate to a new research/replan pass before the workflow can complete.",
    },
  ];
}

function buildChallengeContextFiles(
  workflow: WorkflowRecord,
  manager: HandoffManager,
  handoff: Handoff,
): ChallengeContextFile[] {
  const [researcherId, implementerId, testerId] = getPieHandoffIds(workflow);
  const researcher = loadHandoffByIdOrThrow(manager, workflow, researcherId);
  const implementer = loadHandoffByIdOrThrow(manager, workflow, implementerId);
  const tester = loadHandoffByIdOrThrow(manager, workflow, testerId);
  const stage = resolveChallengeStage(workflow, handoff);

  if (stage === "researcher") {
    return labelledExistingFiles([
      { label: "Research result", path: researcher.artifacts!.result_file },
      { label: "Research brief", path: getResearchBriefPath(workflow) },
      { label: "Approval request", path: getApprovalRequestPath(workflow) },
    ]);
  }

  if (stage === "implementer") {
    return labelledExistingFiles([
      { label: "Approved research result", path: getApprovedResearchResultPath(workflow) },
      { label: "Approved research brief", path: getApprovedResearchBriefPath(workflow) },
      { label: "Implementation result", path: implementer.artifacts!.result_file },
      { label: "Implementation brief", path: getImplementationBriefPath(workflow) },
    ]);
  }

  if (stage === "tester") {
    return labelledExistingFiles([
      { label: "Approved research result", path: getApprovedResearchResultPath(workflow) },
      { label: "Approved research brief", path: getApprovedResearchBriefPath(workflow) },
      { label: "Implementation result", path: implementer.artifacts!.result_file },
      { label: "Implementation brief", path: getImplementationBriefPath(workflow) },
      { label: "Tester result", path: tester.artifacts!.result_file },
      { label: "Verification brief", path: getVerificationBriefPath(workflow) },
    ]);
  }

  return labelledExistingFiles([
    { label: "Approved research result", path: getApprovedResearchResultPath(workflow) },
    { label: "Approved research brief", path: getApprovedResearchBriefPath(workflow) },
    { label: "Implementation result", path: implementer.artifacts!.result_file },
    { label: "Implementation brief", path: getImplementationBriefPath(workflow) },
    { label: "Tester result", path: tester.artifacts!.result_file },
    { label: "Verification brief", path: getVerificationBriefPath(workflow) },
    { label: "Intent confirmation result", path: researcher.artifacts!.result_file },
  ]);
}

function writeChallengeDecisionReport(
  workflow: WorkflowRecord,
  challenge: ChallengeState,
  decision: ReturnType<typeof collectChallengeResults>,
  at: string,
): string {
  const reportPath = buildChallengeReportPath(workflow);
  const findings = decision?.findings ?? [];
  const continueTarget =
    challenge.continue_target.outcome === "complete"
      ? "complete the workflow"
      : challenge.continue_target.outcome === "await_approval"
        ? "return to the approval gate"
        : `continue with ${challenge.continue_target.next_handoff_id ?? "the proposed next handoff"}`;

  const lines = [
    "# Challenge Report",
    "",
    `Completed At: ${at}`,
    `Source Stage: ${challenge.source_stage}`,
    `Source Handoff: ${challenge.source_handoff_id}`,
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
  manager: HandoffManager,
  handoff: Handoff,
  continueDecision: TemplateAdvanceDecision,
  dependencies: WorkflowDependencies | undefined,
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies)();
  const stage = resolveChallengeStage(workflow, handoff);
  const contextFiles = buildChallengeContextFiles(workflow, manager, handoff);
  const workers = await spawnChallengeWorkers(
    {
      workflowId: workflow.id,
      repoPath: workflow.repo_path,
      worktreePath: workflow.worktree_path,
      stage,
      contextFiles,
      autoApprove: workflow.auto_approve,
      agentType: handoff.to.agent_type as AgentType,
      parentTerminalId:
        workflow.parent_terminal_id ?? process.env.TERMCANVAS_TERMINAL_ID,
    },
    dispatchFn(dependencies),
  );

  workflow.challenge_request = undefined;
  workflow.challenge = {
    workers,
    started_at: now,
    source_handoff_id: handoff.id,
    source_stage: stage,
    continue_target: toChallengeContinueTarget(continueDecision),
    return_targets: buildChallengeReturnTargets(workflow, handoff),
    context_files: contextFiles,
  };
  workflow.status = "challenging";
  workflow.failure = undefined;
  workflow.updated_at = now;
  saveWorkflow(workflow);
  return buildStatusView(workflow);
}

async function applyContinueDecision(
  workflow: WorkflowRecord,
  manager: HandoffManager,
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
    continueTarget.outcome === "intent_confirmation" &&
    continueTarget.next_handoff_id &&
    continueTarget.requeue_handoff_ids
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

    for (const requeueHandoffId of continueTarget.requeue_handoff_ids) {
      const requeueHandoff = manager.load(requeueHandoffId);
      if (requeueHandoff) destroyHandoffTerminal(requeueHandoff, dependencies);
      resetHandoffToPending(manager, requeueHandoffId, now());
    }
    prepareResearcherIntentConfirmation(workflow, manager, nextIteration);

    workflow.current_handoff_id = continueTarget.next_handoff_id;
    workflow.status = "running";
    workflow.failure = undefined;
    workflow.result = undefined;
    workflow.confirmation_iteration = nextIteration;
    workflow.updated_at = now();
    saveWorkflow(workflow);
    const nextHandoff = loadHandoffOrThrow(manager, workflow);
    await dispatchPendingHandoff(workflow, nextHandoff, dependencies);
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  if (continueTarget.outcome === "advance" && continueTarget.next_handoff_id) {
    workflow.current_handoff_id = continueTarget.next_handoff_id;
    workflow.status = "running";
    workflow.failure = undefined;
    workflow.updated_at = now();
    saveWorkflow(workflow);
    const nextHandoff = loadHandoffOrThrow(manager, workflow);
    await dispatchPendingHandoff(workflow, nextHandoff, dependencies);
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  if (
    continueTarget.outcome === "loop" &&
    continueTarget.next_handoff_id &&
    continueTarget.requeue_handoff_ids
  ) {
    for (const requeueHandoffId of continueTarget.requeue_handoff_ids) {
      const requeueHandoff = manager.load(requeueHandoffId);
      if (requeueHandoff) destroyHandoffTerminal(requeueHandoff, dependencies);
      resetHandoffToPending(manager, requeueHandoffId, now());
    }
    if (
      workflow.template === "planner-implementer-evaluator" &&
      continueTarget.next_handoff_id === workflow.handoff_ids[0]
    ) {
      prepareResearcherReplan(workflow, manager);
      workflow.confirmation_iteration = 0;
    }
    workflow.current_handoff_id = continueTarget.next_handoff_id;
    workflow.status = "running";
    workflow.failure = undefined;
    workflow.result = undefined;
    workflow.updated_at = now();
    saveWorkflow(workflow);
    const nextHandoff = loadHandoffOrThrow(manager, workflow);
    await dispatchPendingHandoff(workflow, nextHandoff, dependencies);
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

function prepareResearcherIntentConfirmation(
  workflow: WorkflowRecord,
  manager: HandoffManager,
  iteration: number,
): Handoff {
  const [researcherId, implementerId, testerId] = getPieHandoffIds(workflow);
  const researcherHandoff = loadHandoffByIdOrThrow(manager, workflow, researcherId);
  const implementerHandoff = loadHandoffByIdOrThrow(manager, workflow, implementerId);
  const testerHandoff = loadHandoffByIdOrThrow(manager, workflow, testerId);
  const templateResearcher = buildPieTemplatePlan(workflow, manager).handoffs[0];

  if (!researcherHandoff.artifacts || !implementerHandoff.artifacts || !testerHandoff.artifacts) {
    throw new HydraError("Intent confirmation requires task package artifacts for all full-workflow handoffs", {
      errorCode: "WORKFLOW_HANDOFF_MISSING_ARTIFACTS",
      stage: "workflow.intent_confirmation",
      ids: { workflow_id: workflow.id },
    });
  }

  const approvedResearchResult = getApprovedResearchResultPath(workflow);
  const approvedResearchBrief = getApprovedResearchBriefPath(workflow);
  const implementerResultFile = implementerHandoff.artifacts.result_file;
  const implementationBrief = getImplementationBriefPath(workflow);
  const testerResultFile = testerHandoff.artifacts.result_file;
  const testerBrief = getVerificationBriefPath(workflow);
  const maxIterations = workflow.max_confirmation_iterations ?? DEFAULT_MAX_CONFIRMATION_ITERATIONS;
  const intentContextFile = path.join(
    researcherHandoff.artifacts.package_dir,
    "intent-confirmation-context.md",
  );

  fs.writeFileSync(
    intentContextFile,
    [
      "# Researcher Intent Confirmation",
      "",
      "You are now in the final intent-confirmation stage. Do not redo the whole research pass. Decide whether the tested implementation still matches the approved intent and strategy.",
      "",
      "## Read First",
      `- Approved research result: ${approvedResearchResult}`,
      `- Approved research brief: ${approvedResearchBrief}`,
      `- Implementer result: ${implementerResultFile}`,
      `- Implementation brief: ${implementationBrief}`,
      `- Tester result: ${testerResultFile}`,
      `- Verification brief: ${testerBrief}`,
      "",
      "## Decision Modes",
      "1. Complete: the shipped work matches the approved intent and strategy.",
      "2. More implementation: the approved research still holds, but the implementation is not done yet.",
      "3. Replan: the approved research frame is no longer sufficient and the workflow must return to research.",
      "",
      "## Output Requirements",
      "- Use success=true whenever you completed the intent-confirmation decision.",
      "- Use next_action.type=complete when the workflow is done.",
      `- Use next_action.type=handoff and next_action.handoff_id=${implementerId} when more implementation is needed under the same approved research.`,
      `- Use next_action.type=handoff and next_action.handoff_id=${researcherId} with replan=true when the research frame must be rebuilt.`,
      "",
      `This is intent-confirmation iteration ${iteration} of ${maxIterations}.`,
    ].join("\n"),
    "utf-8",
  );

  researcherHandoff.task = {
    ...templateResearcher.task,
    type: "workflow-intent-confirmation",
    title: `Intent Confirmation: ${workflow.task.slice(0, 58)}`,
    description: [
      "Confirm whether the current implementation still matches the approved research intent after verification completed.",
      `Primary task: ${workflow.task}`,
      `Read ${intentContextFile} plus the approved research and verification artifacts before deciding.`,
      `Complete when you can either accept the work, send it back to ${implementerId}, or replan via ${researcherId}.`,
    ].join("\n"),
    acceptance_criteria: [
      "Read the approved research snapshot, implementation brief, verification brief, and intent-confirmation-context.md before deciding",
      "Use success=true when you reached a final intent-confirmation decision",
      "Use next_action.type=complete when the workflow is done",
      `Use next_action.handoff_id=${implementerId} when the same research should continue with more implementation`,
      `Use next_action.handoff_id=${researcherId} with replan=true when the workflow must return to research`,
    ],
  };
  researcherHandoff.context = {
    files: [
      approvedResearchResult,
      approvedResearchBrief,
      implementerResultFile,
      implementationBrief,
      testerResultFile,
      testerBrief,
      intentContextFile,
    ],
    previous_handoffs: [implementerId, testerId],
    shared_state: {
      ...templateResearcher.context.shared_state,
      worktree_path: workflow.worktree_path,
      branch: workflow.branch,
      base_branch: workflow.base_branch,
      approved_research_result_file: approvedResearchResult,
      approved_research_brief_file: approvedResearchBrief,
      implementer_result_file: implementerResultFile,
      implementation_brief_file: implementationBrief,
      tester_result_file: testerResultFile,
      verification_brief_file: testerBrief,
      intent_confirmation_context_file: intentContextFile,
      confirmation_iteration: iteration,
      max_confirmation_iterations: maxIterations,
      downstream_handoff_id: implementerId,
      replan_handoff_id: researcherId,
    },
  };
  rewriteHandoffTaskPackage(workflow, researcherHandoff);
  manager.save(researcherHandoff);
  return researcherHandoff;
}

function prepareResearcherReplan(
  workflow: WorkflowRecord,
  manager: HandoffManager,
): Handoff {
  const [researcherId, implementerId, testerId] = getPieHandoffIds(workflow);
  const researcherHandoff = loadHandoffByIdOrThrow(manager, workflow, researcherId);
  const implementerHandoff = loadHandoffByIdOrThrow(manager, workflow, implementerId);
  const testerHandoff = loadHandoffByIdOrThrow(manager, workflow, testerId);
  const templateResearcher = buildPieTemplatePlan(workflow, manager).handoffs[0];

  if (!researcherHandoff.artifacts || !implementerHandoff.artifacts || !testerHandoff.artifacts) {
    throw new HydraError("Research replan requires task package artifacts for all full-workflow handoffs", {
      errorCode: "WORKFLOW_HANDOFF_MISSING_ARTIFACTS",
      stage: "workflow.replan",
      ids: { workflow_id: workflow.id },
    });
  }

  const approvedResearchResult = getApprovedResearchResultPath(workflow);
  const approvedResearchBrief = getApprovedResearchBriefPath(workflow);
  const implementerResultFile = implementerHandoff.artifacts.result_file;
  const implementationBrief = getImplementationBriefPath(workflow);
  const testerResultFile = testerHandoff.artifacts.result_file;
  const testerBrief = getVerificationBriefPath(workflow);
  const replanContextFile = path.join(
    researcherHandoff.artifacts.package_dir,
    "replan-context.md",
  );

  fs.writeFileSync(
    replanContextFile,
    [
      "# Research Replan Request",
      "",
      "The workflow needs a new research pass because the approved strategy no longer holds.",
      "",
      "## Read First",
      `- Last approved research result: ${approvedResearchResult}`,
      `- Last approved research brief: ${approvedResearchBrief}`,
      `- Implementer result: ${implementerResultFile}`,
      `- Implementation brief: ${implementationBrief}`,
      `- Tester result (if present): ${testerResultFile}`,
      `- Verification brief (if present): ${testerBrief}`,
      "",
      "## Instructions",
      "Produce a fresh research brief that explains how the approved frame broke down and what the next approved implementation path should be.",
      "Do not silently carry the old assumptions forward.",
      "If the new strategy changes user-approved scope or prerequisites, write approval-request.md so the user can confirm before implementation resumes.",
    ].join("\n"),
    "utf-8",
  );

  researcherHandoff.task = {
    ...templateResearcher.task,
    type: "workflow-research-replan",
    title: `Replan Research: ${workflow.task.slice(0, 58)}`,
    description: [
      "Run a new research pass because the previously approved strategy is no longer sufficient.",
      `Primary task: ${workflow.task}`,
      `Read ${replanContextFile} plus the last approved research and the latest implementation/verification artifacts.`,
      `Hydra will pause for approval again before implementation resumes.`,
    ].join("\n"),
    acceptance_criteria: [
      "Read the last approved research snapshot and the latest implementation evidence before replanning",
      "Produce a fresh research-brief.md rather than silently reusing the old frame",
      "Explain why the prior approved strategy no longer holds",
      "Write approval-request.md if the new direction changes scope, prerequisites, or task strategy",
      `Use next_action.handoff_id=${implementerId} when the replanned research handoff is complete`,
    ],
  };
  researcherHandoff.context = {
    files: existingFiles(
      approvedResearchResult,
      approvedResearchBrief,
      implementerResultFile,
      implementationBrief,
      testerResultFile,
      testerBrief,
      replanContextFile,
    ),
    previous_handoffs: [implementerId, testerId],
    shared_state: {
      ...templateResearcher.context.shared_state,
      worktree_path: workflow.worktree_path,
      branch: workflow.branch,
      base_branch: workflow.base_branch,
      approved_research_result_file: approvedResearchResult,
      approved_research_brief_file: approvedResearchBrief,
      implementer_result_file: implementerResultFile,
      implementation_brief_file: implementationBrief,
      tester_result_file: testerResultFile,
      verification_brief_file: testerBrief,
      replan_context_file: replanContextFile,
      downstream_handoff_id: implementerId,
      approval_request_file: getApprovalRequestPath(workflow),
    },
  };
  rewriteHandoffTaskPackage(workflow, researcherHandoff);
  manager.save(researcherHandoff);
  return researcherHandoff;
}

function validateRequiredWorkflowArtifacts(
  workflow: WorkflowRecord,
  handoff: Handoff,
): WorkflowFailure | null {
  if (workflow.template !== "planner-implementer-evaluator") {
    return null;
  }

  let requiredPath: string | null = null;
  let label = "";
  switch (handoff.task.type) {
    case "workflow-research":
    case "workflow-research-replan":
      requiredPath = getResearchBriefPath(workflow);
      label = "research brief";
      break;
    case "workflow-implementation":
      requiredPath = getImplementationBriefPath(workflow);
      label = "implementation brief";
      break;
    case "workflow-verification":
      requiredPath = getVerificationBriefPath(workflow);
      label = "verification brief";
      break;
    default:
      return null;
  }

  if (!requiredPath || fs.existsSync(requiredPath)) {
    return null;
  }

  return {
    code: "WORKFLOW_REQUIRED_ARTIFACT_MISSING",
    message: `Expected ${label} at ${requiredPath} before completing ${handoff.task.type}.`,
    stage: "workflow.required_artifact",
  };
}

function resetHandoffToPending(
  manager: HandoffManager,
  handoffId: string,
  now: string,
): void {
  const handoff = manager.load(handoffId);
  if (!handoff) {
    throw new HydraError(`Handoff not found: ${handoffId}`, {
      errorCode: "WORKFLOW_HANDOFF_NOT_FOUND",
      stage: "workflow.requeue",
      ids: { handoff_id: handoffId },
    });
  }

  // Remove the done marker so the next tick does not treat stale
  // data as evidence of completion. Keep result.json — downstream
  // agents may need it (tester findings for implementer, or the
  // last approved research snapshot for replanning). Phantom
  // completion only triggers when the done file exists.
  if (handoff.artifacts) {
    try { fs.unlinkSync(handoff.artifacts.done_file); } catch {}
  }

  const previousStatus = handoff.status;
  handoff.status = "pending";
  handoff.status_updated_at = now;
  handoff.claim = undefined;
  handoff.last_error = undefined;
  handoff.result = undefined;
  handoff.to = {
    ...handoff.to,
    agent_id: null,
  };
  if (handoff.dispatch) {
    handoff.dispatch.active_terminal_id = null;
  }
  handoff.transitions = handoff.transitions ?? [];
  handoff.transitions.push({
    event: "requeue_handoff",
    from: previousStatus,
    to: "pending",
    at: now,
  });
  manager.save(handoff);
}

function buildStatusView(workflow: WorkflowRecord): WorkflowStatusView {
  const manager = new HandoffManager(workflow.repo_path);
  const handoffs = workflow.handoff_ids
    .map((handoffId) => manager.load(handoffId))
    .filter((handoff): handoff is Handoff => handoff !== null);
  return { workflow, handoffs };
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

function resetFailedOrTimedOutHandoff(
  manager: HandoffManager,
  workflow: WorkflowRecord,
  handoff: Handoff,
  now: string,
): Handoff {
  if (handoff.status !== "failed" && handoff.status !== "timed_out") {
    throw new HydraError(`Workflow ${workflow.id} is not retryable`, {
      errorCode: "WORKFLOW_NOT_RETRYABLE",
      stage: "workflow.retry",
      ids: {
        workflow_id: workflow.id,
        handoff_id: handoff.id,
      },
    });
  }

  if (handoff.retry_count >= handoff.max_retries) {
    throw new HydraError(`Retry limit reached for ${handoff.id}`, {
      errorCode: "WORKFLOW_RETRY_LIMIT_REACHED",
      stage: "workflow.retry",
      ids: {
        workflow_id: workflow.id,
        handoff_id: handoff.id,
      },
    });
  }

  const previousStatus = handoff.status;
  handoff.status = "pending";
  handoff.status_updated_at = now;
  handoff.claim = undefined;
  handoff.last_error = undefined;
  handoff.result = undefined;
  handoff.transitions = handoff.transitions ?? [];
  handoff.transitions.push({
    event: "manual_retry",
    from: previousStatus,
    to: "pending",
    at: now,
  });
  if (handoff.dispatch) {
    handoff.dispatch.active_terminal_id = null;
  }
  manager.save(handoff);
  return handoff;
}

async function dispatchPendingHandoff(
  workflow: WorkflowRecord,
  handoff: Handoff,
  dependencies: WorkflowDependencies,
): Promise<void> {
  const now = nowFn(dependencies);
  const manager = new HandoffManager(workflow.repo_path);
  const stateMachine = new HandoffStateMachine(manager, { now });
  const dispatchCreateOnly = dispatchFn(dependencies);
  const tickId = `tick:${workflow.id}:${now()}`;

  await stateMachine.claimPending(handoff.id, tickId);
  const dispatch = await dispatchCreateOnly(buildDispatchRequestFromHandoff(workflow, handoff));
  await stateMachine.markInProgress(handoff.id, { tickId });
  registerDispatchAttempt(manager, handoff.id, {
    terminalId: dispatch.terminalId,
    agentType: dispatch.terminalType as AgentType,
    prompt: dispatch.prompt,
    startedAt: now(),
  });
}

export async function runWorkflow(
  options: RunWorkflowOptions,
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowStatusView> {
  const now = nowFn(dependencies);
  const repoPath = path.resolve(options.repoPath);
  const workflowId = generateWorkflowId();
  const template = options.template ?? "planner-implementer-evaluator";
  const baseType = options.agentType ?? resolveDefaultAgentType();
  const implementerType = options.implementerType ?? baseType;
  const plannerType = options.plannerType ?? baseType;
  const evaluatorType = options.evaluatorType ?? baseType;
  if (options.autoApprove) {
    for (const agentType of [plannerType, implementerType, evaluatorType]) {
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

  const plannedHandoffIds = template === "single-step"
    ? [generateHandoffId()]
    : [generateHandoffId(), generateHandoffId(), generateHandoffId()];
  const workspace = prepareWorkflowWorkspace(
    repoPath,
    workflowId,
    options.worktreePath,
    dependencies,
  );
  const manager = new HandoffManager(repoPath);
  const plan = buildWorkflowTemplatePlan({
    template,
    workflowId,
    task: options.task,
    plannerAgentType: plannerType,
    implementerAgentType: implementerType,
    evaluatorAgentType: evaluatorType,
    repoPath,
    handoffIds: plannedHandoffIds,
  });

  const createdHandoffs = plan.handoffs.map((handoffPlan) => {
    const taskPackage = buildTaskPackageContext({
      workspaceRoot: repoPath,
      workflowId,
      handoffId: handoffPlan.id,
      createdAt: now(),
      from: handoffPlan.from,
      to: handoffPlan.to,
      task: handoffPlan.task,
      context: {
        ...handoffPlan.context,
        shared_state: {
          ...handoffPlan.context.shared_state,
          worktree_path: workspace.worktreePath,
          branch: workspace.branch,
          base_branch: workspace.baseBranch,
        },
      },
    });
    writeTaskPackage(taskPackage.contract);

    return manager.create({
      id: handoffPlan.id,
      workflow_id: workflowId,
      workspace_root: repoPath,
      worktree_path: workspace.worktreePath,
      from: handoffPlan.from,
      to: handoffPlan.to,
      task: taskPackage.contract.task,
      context: taskPackage.contract.context,
      artifacts: taskPackage.contract.artifacts,
      timeout_minutes: options.timeoutMinutes,
      max_retries: options.maxRetries,
    });
  });

  const workflow: WorkflowRecord = {
    id: workflowId,
    template,
    task: options.task,
    repo_path: repoPath,
    worktree_path: workspace.worktreePath,
    branch: workspace.branch,
    base_branch: workspace.baseBranch,
    own_worktree: workspace.ownWorktree,
    agent_type: implementerType,
    parent_terminal_id: process.env.TERMCANVAS_TERMINAL_ID,
    created_at: now(),
    updated_at: now(),
    status: "pending",
    current_handoff_id: plan.startHandoffId,
    handoff_ids: createdHandoffs.map((handoff) => handoff.id),
    timeout_minutes: options.timeoutMinutes,
    max_retries: options.maxRetries,
    confirmation_iteration: 0,
    max_confirmation_iterations: DEFAULT_MAX_CONFIRMATION_ITERATIONS,
    auto_approve: options.autoApprove,
    approve_plan: options.approvePlan,
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
  const manager = new HandoffManager(repoPath);
  const stateMachine = new HandoffStateMachine(manager, { now });
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  const handoff = loadHandoffOrThrow(manager, workflow);

  if (
    workflow.status === "waiting_for_approval" ||
    workflow.status === "waiting_for_challenge_decision"
  ) {
    return buildStatusView(workflow);
  }

  if (workflow.status === "challenging" && workflow.challenge) {
    const challengeDecision = collectChallengeResults(workflow.challenge);
    if (challengeDecision === null) {
      return buildStatusView(workflow);
    }

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

  if (handoff.status === "pending") {
    await dispatchPendingHandoff(workflow, handoff, dependencies);
    workflow.status = "running";
    workflow.updated_at = now();
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  if (handoff.status === "claimed" || handoff.status === "in_progress") {
    const contract = loadContract(handoff);
    const collected = collectTaskPackage(contract);

    if (collected.status === "completed") {
      const artifactFailure = validateRequiredWorkflowArtifacts(workflow, handoff);
      if (artifactFailure) {
        await stateMachine.markFailed(handoff.id, {
          ...artifactFailure,
          retryable: false,
          at: now(),
        });
        saveWorkflowFailure(workflow, artifactFailure, now());
        return buildStatusView(workflow);
      }

      await stateMachine.markCompleted(handoff.id, mapResultContract(collected.result));
      destroyHandoffTerminal(handoff, dependencies);
      workflow.updated_at = now();
      const decision = resolveTemplateAdvance(
        workflow.template as WorkflowTemplateName,
        workflow.handoff_ids,
        handoff.id,
        collected.result,
        { currentTaskType: handoff.task.type },
      );
      if (
        workflow.challenge_request?.source_handoff_id === handoff.id &&
        decision.outcome !== "fail"
      ) {
        if (decision.outcome === "complete") {
          workflow.result = collected.result;
        }
        return startChallengeForBoundary(
          workflow,
          manager,
          handoff,
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
      await stateMachine.markFailed(handoff.id, collected.failure);
      saveWorkflowFailure(workflow, collected.failure, now());
      return buildStatusView(workflow);
    }

    // Early exit detection via telemetry: if the agent process died
    // without writing result/done, detect it within seconds instead
    // of waiting for the full timeout (e.g. 30 minutes).
    const activeTerminalId = handoff.dispatch?.active_terminal_id;
    if (activeTerminalId) {
      const alive = checkTerminalAliveFn(dependencies)(activeTerminalId);
      if (alive === false) {
        const lastAttempt = handoff.dispatch?.attempts.at(-1);
        const dispatchedMs = lastAttempt?.started_at
          ? Date.parse(lastAttempt.started_at)
          : 0;
        const elapsedMs = Date.parse(now()) - dispatchedMs;
        if (elapsedMs > SPAWN_GRACE_PERIOD_MS) {
          destroyHandoffTerminal(handoff, dependencies);
          await stateMachine.markTimedOut(handoff.id, {
            code: "HANDOFF_PROCESS_EXITED",
            message: `Agent process exited without writing result (elapsed ${Math.round(elapsedMs / 1000)}s)`,
            stage: "workflow.telemetry_check",
          });
          const retryDecision = await stateMachine.scheduleRetry(handoff.id);
          workflow.updated_at = now();
          if (retryDecision.handoff.status === "failed") {
            saveWorkflowFailure(workflow, {
              code: "HANDOFF_PROCESS_EXITED",
              message: "Agent process exited and retry limit reached",
              stage: "workflow.telemetry_check",
            }, now());
            return buildStatusView(workflow);
          }
          const dispatch = await dispatchFn(dependencies)(
            buildDispatchRequestFromHandoff(workflow, handoff),
          );
          await stateMachine.claimPending(
            handoff.id,
            `retry:${handoff.id}:${now()}`,
          );
          await stateMachine.markInProgress(handoff.id, {
            tickId: `retry:${handoff.id}:${now()}`,
          });
          registerDispatchAttempt(manager, handoff.id, {
            terminalId: dispatch.terminalId,
            agentType: dispatch.terminalType as AgentType,
            prompt: dispatch.prompt,
            startedAt: now(),
            retryOf: activeTerminalId,
          });
          workflow.status = "running";
          workflow.failure = undefined;
          saveWorkflow(workflow);
          return buildStatusView(workflow);
        }
      }
    }

    const retryOutcome = await retryTimedOutHandoff(
      {
        handoffId: handoff.id,
        timeoutCheckedAt: now(),
        dispatchRequest: buildDispatchRequestFromHandoff(workflow, handoff),
      },
      {
        manager,
        stateMachine,
        dispatchCreateOnly: dispatchFn(dependencies),
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
      const failedHandoff = loadHandoffOrThrow(manager, workflow);
      saveWorkflowFailure(
        workflow,
        {
          code: failedHandoff.last_error?.code ?? "WORKFLOW_RETRY_FAILED",
          message: failedHandoff.last_error?.message ?? "Retry failed",
          stage: failedHandoff.last_error?.stage ?? "workflow.retry",
        },
        now(),
      );
      return buildStatusView(workflow);
    }

    workflow.status = "running";
    saveWorkflow(workflow);
    return buildStatusView(workflow);
  }

  workflow.updated_at = now();
  if (handoff.status === "completed") {
    workflow.status = workflow.result?.success === false ? "failed" : "completed";
  } else if (handoff.status === "failed" || handoff.status === "timed_out") {
    workflow.status = "failed";
    if (handoff.last_error) {
      workflow.failure = {
        code: handoff.last_error.code,
        message: handoff.last_error.message,
        stage: handoff.last_error.stage,
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
      view.workflow.status === "completed" ||
      view.workflow.status === "failed" ||
      view.workflow.status === "waiting_for_approval" ||
      view.workflow.status === "waiting_for_challenge_decision"
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
  const manager = new HandoffManager(workflow.repo_path);
  const handoff = loadHandoffOrThrow(manager, workflow);
  resetFailedOrTimedOutHandoff(manager, workflow, handoff, now());
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
  const manager = new HandoffManager(repoPath);

  if (workflow.challenge || workflow.status === "challenging" || workflow.status === "waiting_for_challenge_decision") {
    throw new HydraError("Workflow already has an active challenge run or pending challenge decision", {
      errorCode: "WORKFLOW_CHALLENGE_ALREADY_ACTIVE",
      stage: "workflow.challenge_request",
      ids: { workflow_id: workflow.id },
    });
  }

  if (workflow.template !== "planner-implementer-evaluator") {
    throw new HydraError("Explicit challenge is currently only supported for full researcher/implementer/tester workflows", {
      errorCode: "WORKFLOW_CHALLENGE_UNSUPPORTED_TEMPLATE",
      stage: "workflow.challenge_request",
      ids: { workflow_id: workflow.id },
    });
  }

  if (workflow.status === "waiting_for_approval") {
    const handoff = loadHandoffOrThrow(manager, workflow);
    return startChallengeForBoundary(
      workflow,
      manager,
      handoff,
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
    source_handoff_id: workflow.current_handoff_id,
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
  const manager = new HandoffManager(repoPath);

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

  for (const requeueHandoffId of target.requeue_handoff_ids) {
    const requeueHandoff = manager.load(requeueHandoffId);
    if (requeueHandoff) destroyHandoffTerminal(requeueHandoff, dependencies);
    resetHandoffToPending(manager, requeueHandoffId, now());
  }

  if (target.mode === "replan" && target.role === "researcher") {
    prepareResearcherReplan(workflow, manager);
    workflow.confirmation_iteration = 0;
  }

  workflow.current_handoff_id = target.handoff_id;
  workflow.status = "running";
  workflow.failure = undefined;
  workflow.result = undefined;
  workflow.updated_at = now();
  saveWorkflow(workflow);

  const nextHandoff = loadHandoffOrThrow(manager, workflow);
  await dispatchPendingHandoff(workflow, nextHandoff, dependencies);
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

  const manager = new HandoffManager(repoPath);
  const researcherId = workflow.handoff_ids[0];
  const researcherHandoff = loadHandoffByIdOrThrow(manager, workflow, researcherId);
  persistApprovedResearchSnapshot(workflow, researcherHandoff);
  const implementerId = workflow.handoff_ids[1];
  workflow.current_handoff_id = implementerId;
  workflow.status = "running";
  workflow.approve_plan = false;
  workflow.updated_at = now();
  saveWorkflow(workflow);

  const nextHandoff = loadHandoffOrThrow(manager, workflow);
  await dispatchPendingHandoff(workflow, nextHandoff, dependencies);
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

  const manager = new HandoffManager(repoPath);
  const researcherId = workflow.handoff_ids[0];
  const researcherHandoff = manager.load(researcherId);
  if (!researcherHandoff) {
    throw new HydraError(`Researcher handoff not found: ${researcherId}`, {
      errorCode: "WORKFLOW_HANDOFF_NOT_FOUND",
      stage: "workflow.revise",
      ids: { workflow_id: workflow.id, handoff_id: researcherId },
    });
  }

  const revisionFile = path.join(researcherHandoff.artifacts!.package_dir, "revision.md");
  const previousResearchResultFile = researcherHandoff.artifacts!.result_file;
  const previousResearchBriefFile = getResearchBriefPath(workflow);
  fs.writeFileSync(
    revisionFile,
    [
      "# Research Revision Request",
      "",
      "The previous research pass was reviewed and needs revision.",
      "",
      "## Previous Research",
      `Read the previous research result at: ${previousResearchResultFile}`,
      `Read the previous research brief at: ${previousResearchBriefFile}`,
      "",
      "## Feedback",
      options.feedback,
      "",
      "## Instructions",
      "Revise the research output to address the feedback above. Update the problem framing, constraints, architecture impact, structural blockers, and verification focus as needed.",
    ].join("\n"),
    "utf-8",
  );

  researcherHandoff.context.files = [
    ...researcherHandoff.context.files.filter((f) => !f.endsWith("revision.md")),
    previousResearchResultFile,
    previousResearchBriefFile,
    revisionFile,
  ];
  manager.save(researcherHandoff);

  resetHandoffToPending(manager, researcherId, now());
  const resetResearcherHandoff = loadHandoffByIdOrThrow(manager, workflow, researcherId);
  rewriteHandoffTaskPackage(workflow, resetResearcherHandoff);
  manager.save(resetResearcherHandoff);
  workflow.current_handoff_id = researcherId;
  workflow.status = "running";
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
