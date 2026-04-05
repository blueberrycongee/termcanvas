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
  buildWorkflowTemplatePlan,
  plannerControlPlanFile,
  resolveTemplateAdvance,
  type WorkflowTemplateName,
} from "./workflow-template.ts";
import {
  spawnChallengeWorkers,
  collectChallengeResults,
  destroyChallengeTerminals,
} from "./challenge.ts";
import {
  deleteWorkflow,
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
const DEFAULT_MAX_SATISFACTION_ITERATIONS = 3;

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

function getPlannerControlPlanPath(workflow: WorkflowRecord): string {
  const [plannerId] = getPieHandoffIds(workflow);
  return plannerControlPlanFile(workflow.repo_path, workflow.id, plannerId);
}

function persistPlannerControlPlan(
  workflow: WorkflowRecord,
  plannerHandoff: Handoff,
): string {
  if (!plannerHandoff.artifacts) {
    throw new HydraError(`Planner handoff ${plannerHandoff.id} is missing artifacts`, {
      errorCode: "WORKFLOW_HANDOFF_MISSING_ARTIFACTS",
      stage: "workflow.persist_control_plan",
      ids: {
        workflow_id: workflow.id,
        handoff_id: plannerHandoff.id,
      },
    });
  }

  const controlPlanPath = getPlannerControlPlanPath(workflow);
  fs.copyFileSync(plannerHandoff.artifacts.result_file, controlPlanPath);
  return controlPlanPath;
}

function preparePlannerSatisfactionCheck(
  workflow: WorkflowRecord,
  manager: HandoffManager,
  iteration: number,
): Handoff {
  const [plannerId, implementerId, evaluatorId] = getPieHandoffIds(workflow);
  const plannerHandoff = loadHandoffByIdOrThrow(manager, workflow, plannerId);
  const implementerHandoff = loadHandoffByIdOrThrow(manager, workflow, implementerId);
  const evaluatorHandoff = loadHandoffByIdOrThrow(manager, workflow, evaluatorId);
  const templatePlanner = buildPieTemplatePlan(workflow, manager).handoffs[0];

  if (!plannerHandoff.artifacts || !implementerHandoff.artifacts || !evaluatorHandoff.artifacts) {
    throw new HydraError("Planner satisfaction check requires task package artifacts for all PIE handoffs", {
      errorCode: "WORKFLOW_HANDOFF_MISSING_ARTIFACTS",
      stage: "workflow.satisfaction_check",
      ids: { workflow_id: workflow.id },
    });
  }

  const plannerResultFile = getPlannerControlPlanPath(workflow);
  const implementerResultFile = implementerHandoff.artifacts.result_file;
  const evaluatorResultFile = evaluatorHandoff.artifacts.result_file;
  const maxIterations = workflow.max_satisfaction_iterations ?? DEFAULT_MAX_SATISFACTION_ITERATIONS;
  const satisfactionContextFile = path.join(
    plannerHandoff.artifacts.package_dir,
    "satisfaction-context.md",
  );

  fs.writeFileSync(
    satisfactionContextFile,
    [
      "# Planner Satisfaction Check",
      "",
      "You are now performing a satisfaction check, not initial planning.",
      "",
      "## Read First",
      `- Current controlling plan: ${plannerResultFile}`,
      `- Implementer result: ${implementerResultFile}`,
      `- Evaluator result: ${evaluatorResultFile}`,
      "",
      "## Decision Modes",
      "1. Satisfied: set `satisfaction: true` only when the existing controlling plan still matches the shipped state.",
      "2. Replan required: set `satisfaction: false`, `replan: true`, and write a revised plan from scratch.",
      "3. Same plan, more implementation required: set `satisfaction: false`, `replan: false`, and preserve the controlling plan while directing the implementer to continue.",
      "",
      "## Output Requirements",
      "- Your result.json must include a boolean `satisfaction` field.",
      "- If `satisfaction` is false, your result.json must also include a boolean `replan` field.",
      "- Use `success=true` whenever you reached a satisfaction decision, even when `satisfaction=false`.",
      "- Use `success=false` only when you could not complete the satisfaction check itself.",
      "- If satisfied, use `next_action.type=complete`.",
      `- If replanning is required, use next_action.type=handoff and next_action.handoff_id=${plannerId}.`,
      `- If the same plan should continue, use next_action.type=handoff and next_action.handoff_id=${implementerId}.`,
      "",
      `This is satisfaction iteration ${iteration} of ${maxIterations}.`,
    ].join("\n"),
    "utf-8",
  );

  plannerHandoff.task = {
    ...templatePlanner.task,
    type: "workflow-plan-satisfaction-check",
    title: `Satisfaction Check: ${workflow.task.slice(0, 60)}`,
    description: [
      "You are now performing a planner satisfaction check after implementation and evaluation completed.",
      `Primary task: ${workflow.task}`,
      `Read the current plan at ${plannerResultFile}, the implementer result at ${implementerResultFile}, the evaluator result at ${evaluatorResultFile}, and ${satisfactionContextFile}.`,
      `Complete when you can either accept the work, replan via ${plannerId}, or send the same plan back to ${implementerId}.`,
    ].join("\n"),
    acceptance_criteria: [
      "Read the current plan, implementer result, evaluator result, and satisfaction-context.md before deciding",
      "Include `satisfaction` as a boolean in result.json",
      "If `satisfaction` is false, include `replan` as a boolean in result.json",
      "Use `success=true` whenever you reached a satisfaction decision",
      "Use next_action.type=complete when satisfaction=true",
      `Use next_action.handoff_id=${plannerId} when replan=true`,
      `Use next_action.handoff_id=${implementerId} when replan=false`,
    ],
  };
  plannerHandoff.context = {
    files: [
      plannerResultFile,
      implementerResultFile,
      evaluatorResultFile,
      satisfactionContextFile,
    ],
    previous_handoffs: [implementerId, evaluatorId],
    shared_state: {
      ...templatePlanner.context.shared_state,
      worktree_path: workflow.worktree_path,
      branch: workflow.branch,
      base_branch: workflow.base_branch,
      planner_result_file: plannerResultFile,
      implementer_result_file: implementerResultFile,
      evaluator_result_file: evaluatorResultFile,
      satisfaction_context_file: satisfactionContextFile,
      satisfaction_iteration: iteration,
      max_satisfaction_iterations: maxIterations,
      downstream_handoff_id: implementerId,
    },
  };
  rewriteHandoffTaskPackage(workflow, plannerHandoff);
  manager.save(plannerHandoff);
  return plannerHandoff;
}

function preparePlannerReplan(
  workflow: WorkflowRecord,
  manager: HandoffManager,
): Handoff {
  const [plannerId, implementerId, evaluatorId] = getPieHandoffIds(workflow);
  const plannerHandoff = loadHandoffByIdOrThrow(manager, workflow, plannerId);
  const implementerHandoff = loadHandoffByIdOrThrow(manager, workflow, implementerId);
  const evaluatorHandoff = loadHandoffByIdOrThrow(manager, workflow, evaluatorId);
  const templatePlanner = buildPieTemplatePlan(workflow, manager).handoffs[0];

  if (!plannerHandoff.artifacts || !implementerHandoff.artifacts || !evaluatorHandoff.artifacts) {
    throw new HydraError("Planner replan requires task package artifacts for all PIE handoffs", {
      errorCode: "WORKFLOW_HANDOFF_MISSING_ARTIFACTS",
      stage: "workflow.replan",
      ids: { workflow_id: workflow.id },
    });
  }

  const controlPlanFile = getPlannerControlPlanPath(workflow);
  const satisfactionDecisionFile = plannerHandoff.artifacts.result_file;
  const replanContextFile = path.join(
    plannerHandoff.artifacts.package_dir,
    "replan-context.md",
  );

  fs.writeFileSync(
    replanContextFile,
    [
      "# Planner Replan Request",
      "",
      "The previous plan was not satisfactory after implementation and evaluation.",
      "",
      "## Read First",
      `- Previous controlling plan: ${controlPlanFile}`,
      `- Implementer result: ${implementerHandoff.artifacts.result_file}`,
      `- Evaluator result: ${evaluatorHandoff.artifacts.result_file}`,
      `- Satisfaction decision: ${satisfactionDecisionFile}`,
      "",
      "## Instructions",
      "Produce a fresh three-section plan that addresses why the previous plan failed.",
      "Do not simply restate the previous plan. Use the implementation outcome and evaluator findings as first-class planning input.",
    ].join("\n"),
    "utf-8",
  );

  plannerHandoff.task = {
    ...templatePlanner.task,
    type: "workflow-replan",
    title: `Replan: ${workflow.task.slice(0, 64)}`,
    description: [
      "You are replanning from scratch because the previous plan did not lead to a satisfactory implementation.",
      `Primary task: ${workflow.task}`,
      `Read the previous controlling plan at ${controlPlanFile}, the implementer result at ${implementerHandoff.artifacts.result_file}, the evaluator result at ${evaluatorHandoff.artifacts.result_file}, the previous satisfaction decision at ${satisfactionDecisionFile}, and ${replanContextFile}.`,
      `Hand off to ${implementerId} once the new plan is concrete and actionable.`,
    ].join("\n"),
    acceptance_criteria: [
      "Read the previous plan, implementer result, evaluator result, and replan-context.md before replanning",
      "Keep the planner output in the three required sections: Problems Found, Constraints, Implementation Plan",
      "Explain how the new plan addresses the failure modes discovered after implementation",
      `Use next_action.handoff_id=${implementerId} when implementation should restart`,
    ],
  };
  plannerHandoff.context = {
    files: [
      controlPlanFile,
      implementerHandoff.artifacts.result_file,
      evaluatorHandoff.artifacts.result_file,
      satisfactionDecisionFile,
      replanContextFile,
    ],
    previous_handoffs: [implementerId, evaluatorId],
    shared_state: {
      ...templatePlanner.context.shared_state,
      worktree_path: workflow.worktree_path,
      branch: workflow.branch,
      base_branch: workflow.base_branch,
      planner_result_file: controlPlanFile,
      implementer_result_file: implementerHandoff.artifacts.result_file,
      evaluator_result_file: evaluatorHandoff.artifacts.result_file,
      replan_context_file: replanContextFile,
      previous_satisfaction_result_file: satisfactionDecisionFile,
      downstream_handoff_id: implementerId,
    },
  };
  rewriteHandoffTaskPackage(workflow, plannerHandoff);
  manager.save(plannerHandoff);
  return plannerHandoff;
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
    satisfaction_iteration: 0,
    max_satisfaction_iterations: DEFAULT_MAX_SATISFACTION_ITERATIONS,
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

  if (workflow.status === "waiting_for_approval") {
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

    if (challengeDecision.override) {
      // Write challenge findings to the evaluator's result file so
      const evaluatorHandoffId = workflow.challenge.evaluator_handoff_id;
      const evaluatorHandoff = manager.load(evaluatorHandoffId);
      if (evaluatorHandoff?.artifacts) {
        const syntheticResult = {
          version: "hydra/v2",
          handoff_id: evaluatorHandoffId,
          workflow_id: workflow.id,
          success: false,
          summary: challengeDecision.summary,
          outputs: [],
          evidence: workflow.challenge.workers.map((w) => `challenge:${w.methodology}`),
          next_action: {
            type: "handoff",
            reason: "Challenge workers found issues the evaluator missed",
            handoff_id: workflow.handoff_ids[1],
          },
        };
        fs.writeFileSync(
          evaluatorHandoff.artifacts.result_file,
          JSON.stringify(syntheticResult, null, 2),
          "utf-8",
        );
      }

      const implementerId = workflow.handoff_ids[1];
      const evaluatorId = workflow.handoff_ids[2];
      for (const requeueId of [implementerId, evaluatorId]) {
        const requeueHandoff = manager.load(requeueId);
        if (requeueHandoff) destroyHandoffTerminal(requeueHandoff, dependencies);
        resetHandoffToPending(manager, requeueId, now());
      }

      workflow.current_handoff_id = implementerId;
      workflow.status = "running";
      workflow.failure = undefined;
      workflow.result = undefined;
      workflow.challenge = undefined;
      workflow.challenge_completed = true;
      workflow.updated_at = now();
      saveWorkflow(workflow);

      const nextHandoff = loadHandoffOrThrow(manager, workflow);
      await dispatchPendingHandoff(workflow, nextHandoff, dependencies);
      workflow.updated_at = now();
      saveWorkflow(workflow);
      return buildStatusView(workflow);
    }

    workflow.status = "completed";
    workflow.failure = undefined;
    workflow.challenge = undefined;
    workflow.challenge_completed = true;
    workflow.updated_at = now();
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
      await stateMachine.markCompleted(handoff.id, mapResultContract(collected.result));
      destroyHandoffTerminal(handoff, dependencies);
      workflow.updated_at = now();
      if (
        workflow.template === "planner-implementer-evaluator" &&
        handoff.id === workflow.handoff_ids[0] &&
        handoff.task.type !== "workflow-plan-satisfaction-check" &&
        collected.result.success
      ) {
        persistPlannerControlPlan(workflow, handoff);
      }
      const decision = resolveTemplateAdvance(
        workflow.template as WorkflowTemplateName,
        workflow.handoff_ids,
        handoff.id,
        collected.result,
        {
          approvePlan: workflow.approve_plan,
          isSatisfactionCheck: handoff.task.type === "workflow-plan-satisfaction-check",
        },
      );
      if (decision.outcome === "await_approval") {
        workflow.status = "waiting_for_approval";
        workflow.updated_at = now();
        saveWorkflow(workflow);
        return buildStatusView(workflow);
      }
      if (decision.outcome === "satisfaction_check" && decision.nextHandoffId && decision.requeueHandoffIds) {
        const nextIteration = (workflow.satisfaction_iteration ?? 0) + 1;
        const maxIterations = workflow.max_satisfaction_iterations ?? DEFAULT_MAX_SATISFACTION_ITERATIONS;
        if (nextIteration > maxIterations) {
          saveWorkflowFailure(
            workflow,
            {
              code: "WORKFLOW_MAX_SATISFACTION_ITERATIONS_REACHED",
              message: `Planner satisfaction check exceeded the iteration cap (${maxIterations}).`,
              stage: "workflow.satisfaction_check",
            },
            now(),
          );
          return buildStatusView(workflow);
        }

        for (const requeueHandoffId of decision.requeueHandoffIds) {
          const requeueHandoff = manager.load(requeueHandoffId);
          if (requeueHandoff) destroyHandoffTerminal(requeueHandoff, dependencies);
          resetHandoffToPending(manager, requeueHandoffId, now());
        }
        preparePlannerSatisfactionCheck(workflow, manager, nextIteration);

        workflow.current_handoff_id = decision.nextHandoffId;
        workflow.status = "running";
        workflow.failure = undefined;
        workflow.result = undefined;
        workflow.satisfaction_iteration = nextIteration;
        workflow.updated_at = now();
        saveWorkflow(workflow);
        const nextHandoff = loadHandoffOrThrow(manager, workflow);
        await dispatchPendingHandoff(workflow, nextHandoff, dependencies);
        workflow.updated_at = now();
        saveWorkflow(workflow);
        return buildStatusView(workflow);
      }
      if (decision.outcome === "complete") {
        // For PIE template, run challenge gate after the planner confirms satisfaction.
        if (
          workflow.template === "planner-implementer-evaluator" &&
          !workflow.challenge_completed &&
          handoff.id === workflow.handoff_ids[0] &&
          (workflow.satisfaction_iteration ?? 0) > 0
        ) {
          const [, , evaluatorHandoffId] = getPieHandoffIds(workflow);
          const evaluatorHandoff = loadHandoffByIdOrThrow(manager, workflow, evaluatorHandoffId);
          const plannerResultFile = getPlannerControlPlanPath(workflow);
          const evaluatorResultFile = path.join(
            repoPath, ".hydra", "workflows", workflow.id,
            evaluatorHandoffId, "result.json",
          );
          const challenge = await spawnChallengeWorkers(
            {
              workflowId: workflow.id,
              repoPath,
              worktreePath: workflow.worktree_path,
              evaluatorResultFile,
              plannerResultFile,
              evaluatorHandoffId,
              autoApprove: workflow.auto_approve,
              agentType: evaluatorHandoff.to.agent_type as AgentType,
              parentTerminalId:
                workflow.parent_terminal_id ?? process.env.TERMCANVAS_TERMINAL_ID,
            },
            dispatchFn(dependencies),
          );
          workflow.challenge = challenge;
          workflow.result = collected.result;
          workflow.status = "challenging";
          workflow.updated_at = now();
          saveWorkflow(workflow);
          return buildStatusView(workflow);
        }

        workflow.result = collected.result;
        workflow.status = "completed";
        workflow.failure = undefined;
        saveWorkflow(workflow);
        return buildStatusView(workflow);
      }
      if (decision.outcome === "advance" && decision.nextHandoffId) {
        workflow.current_handoff_id = decision.nextHandoffId;
        workflow.status = "running";
        workflow.failure = undefined;
        saveWorkflow(workflow);
        const nextHandoff = loadHandoffOrThrow(manager, workflow);
        await dispatchPendingHandoff(workflow, nextHandoff, dependencies);
        workflow.updated_at = now();
        saveWorkflow(workflow);
        return buildStatusView(workflow);
      }
      if (decision.outcome === "loop" && decision.nextHandoffId && decision.requeueHandoffIds) {
        for (const requeueHandoffId of decision.requeueHandoffIds) {
          const requeueHandoff = manager.load(requeueHandoffId);
          if (requeueHandoff) destroyHandoffTerminal(requeueHandoff, dependencies);
          resetHandoffToPending(manager, requeueHandoffId, now());
        }
        if (
          workflow.template === "planner-implementer-evaluator" &&
          decision.requeueHandoffIds.includes(workflow.handoff_ids[0]) &&
          decision.nextHandoffId === workflow.handoff_ids[0]
        ) {
          preparePlannerReplan(workflow, manager);
        }
        workflow.current_handoff_id = decision.nextHandoffId;
        workflow.status = "running";
        workflow.failure = undefined;
        workflow.result = undefined;
        saveWorkflow(workflow);
        const nextHandoff = loadHandoffOrThrow(manager, workflow);
        await dispatchPendingHandoff(workflow, nextHandoff, dependencies);
        workflow.updated_at = now();
        saveWorkflow(workflow);
        return buildStatusView(workflow);
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
      view.workflow.status === "waiting_for_approval"
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
  const plannerId = workflow.handoff_ids[0];
  const plannerHandoff = manager.load(plannerId);
  if (!plannerHandoff) {
    throw new HydraError(`Planner handoff not found: ${plannerId}`, {
      errorCode: "WORKFLOW_HANDOFF_NOT_FOUND",
      stage: "workflow.revise",
      ids: { workflow_id: workflow.id, handoff_id: plannerId },
    });
  }

  const revisionFile = path.join(plannerHandoff.artifacts!.package_dir, "revision.md");
  const previousPlanFile = getPlannerControlPlanPath(workflow);
  fs.writeFileSync(
    revisionFile,
    [
      "# Plan Revision Request",
      "",
      "The previous plan was reviewed and needs revision.",
      "",
      "## Previous Plan",
      `Read the previous plan at: ${previousPlanFile}`,
      "",
      "## Feedback",
      options.feedback,
      "",
      "## Instructions",
      "Revise the plan to address the feedback above. Keep the three-section structure (Problems Found, Constraints, Implementation Plan). You may add, remove, or modify any section based on the feedback.",
    ].join("\n"),
    "utf-8",
  );

  plannerHandoff.context.files = [
    ...plannerHandoff.context.files.filter((f) => !f.endsWith("revision.md")),
    previousPlanFile,
    revisionFile,
  ];
  manager.save(plannerHandoff);

  resetHandoffToPending(manager, plannerId, now());
  const resetPlannerHandoff = loadHandoffByIdOrThrow(manager, workflow, plannerId);
  rewriteHandoffTaskPackage(workflow, resetPlannerHandoff);
  manager.save(resetPlannerHandoff);
  workflow.current_handoff_id = plannerId;
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
