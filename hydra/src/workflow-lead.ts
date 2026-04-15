import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createCheckpoint as defaultCreateCheckpoint,
  rollbackToCheckpoint as defaultRollbackToCheckpoint,
  removeCheckpointRef,
  type CheckpointResult,
} from "./checkpoint.ts";
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
import {
  registerDispatchAttempt,
  hasAssignmentTimedOut,
  retryTimedOutAssignment,
} from "./retry.ts";
import { loadRole, type RoleTerminal } from "./roles/loader.ts";
import { SUPPORTED_AGENT_TYPES } from "./agent-selection.ts";
import { writeRunTask } from "./run-task.ts";
import { buildTaskSpecFromIntent } from "./task-spec-builder.ts";
import {
  writeDispatchFeedback,
  writeDispatchIntent,
  writeWorkbenchIntent,
  writeWorkbenchSummary,
} from "./artifacts.ts";
import {
  loadWorkbench,
  saveWorkbench,
  WORKBENCH_STATE_SCHEMA_VERSION,
  type RetryPolicy,
  type WorkbenchFailure,
  type Dispatch,
  type WorkbenchRecord,
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
  getDispatchFeedbackFile,
  getDispatchIntentFile,
  getRunReportFile,
  getRunResultFile,
  getRunTaskFile,
  getWorkbenchIntentFile,
  getWorkbenchSummaryFile,
} from "./layout.ts";
import { appendLedger } from "./ledger.ts";
import { ensureLeadCaller } from "./lead-guard.ts";
import { askFollowUp, type AskFollowUpResult } from "./ask.ts";
import type { DecisionPoint, DispatchStatus } from "./decision.ts";
import type { LeadAssessment } from "./ledger.ts";

// --- Constants ---

const SPAWN_GRACE_PERIOD_MS = 15_000;

// --- Dependencies ---

export interface WorkbenchDependencies {
  now?: () => string;
  dispatchCreateOnly?: (request: DispatchCreateOnlyRequest) => Promise<DispatchCreateOnlyResult>;
  sleep?: (ms: number) => Promise<void>;
  syncProject?: (repoPath: string) => void;
  destroyTerminal?: (terminalId: string) => void;
  checkTerminalAlive?: (terminalId: string) => boolean | null;
  /**
   * Test seam for `askDispatch`. In production this delegates to
   * askFollowUp from ./ask.ts, which spawns a real claude/codex
   * subprocess. Tests inject a fake that returns a deterministic
   * answer without touching the network.
   */
  askFollowUp?: (opts: {
    cli: AgentType;
    sessionId: string;
    message: string;
    workdir: string;
    timeoutMs?: number;
  }) => Promise<AskFollowUpResult>;
  /** Test seam for checkpoint creation. */
  createCheckpoint?: (worktreePath: string, refName: string) => CheckpointResult;
  /** Test seam for checkpoint rollback. */
  rollbackToCheckpoint?: (worktreePath: string, checkpoint: CheckpointResult) => void;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function nowFn(deps?: WorkbenchDependencies): () => string {
  return deps?.now ?? (() => new Date().toISOString());
}
function dispatchFn(deps?: WorkbenchDependencies) {
  return deps?.dispatchCreateOnly ?? defaultDispatchCreateOnly;
}
function sleepFn(deps?: WorkbenchDependencies) {
  return deps?.sleep ?? DEFAULT_SLEEP;
}
function syncProjectFn(deps?: WorkbenchDependencies) {
  if (deps?.syncProject) return deps.syncProject;
  if (deps?.dispatchCreateOnly) return (_: string) => {};
  return ensureProjectTracked;
}
function destroyTerminalFn(deps?: WorkbenchDependencies) {
  if (deps?.destroyTerminal) return deps.destroyTerminal;
  if (deps?.dispatchCreateOnly) return (_: string) => {};
  return terminalDestroy;
}
function checkTerminalAliveFn(deps?: WorkbenchDependencies): (id: string) => boolean | null {
  if (deps?.checkTerminalAlive) return deps.checkTerminalAlive;
  return (_id: string) => {
    try {
      if (!isTermCanvasRunning()) return null;
      return null; // cannot check without telemetry import cycle
    } catch { return null; }
  };
}
function createCheckpointFn(deps?: WorkbenchDependencies) {
  if (deps?.createCheckpoint) return deps.createCheckpoint;
  // When running in a test harness (dispatchCreateOnly injected), default to
  // a no-op checkpoint that records an empty SHA so rollback is also a no-op.
  if (deps?.dispatchCreateOnly) return (_wt: string, _ref: string): CheckpointResult => ({ sha: "", head_sha: "", was_dirty: false });
  return defaultCreateCheckpoint;
}
function rollbackToCheckpointFn(deps?: WorkbenchDependencies) {
  if (deps?.rollbackToCheckpoint) return deps.rollbackToCheckpoint;
  if (deps?.dispatchCreateOnly) return (_wt: string, _cp: CheckpointResult) => {};
  return defaultRollbackToCheckpoint;
}

// --- ID generation ---

function generateWorkbenchId(): string {
  return `workbench-${crypto.randomBytes(6).toString("hex")}`;
}
function generateAssignmentId(): string {
  return `assignment-${crypto.randomBytes(6).toString("hex")}`;
}
function generateRunId(): string {
  return `run-${crypto.randomBytes(6).toString("hex")}`;
}

// --- Infrastructure ---

function getCurrentBranch(repoPath: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoPath, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return "main"; }
}

function prepareWorkbenchWorkspace(
  repoPath: string,
  workbenchId: string,
  requestedWorktreePath: string | undefined,
  deps?: WorkbenchDependencies,
): { worktreePath: string; branch: string | null; baseBranch: string; ownWorktree: boolean } {
  const repo = path.resolve(repoPath);
  const baseBranch = getCurrentBranch(repo);

  if (requestedWorktreePath) {
    syncProjectFn(deps)(repo);
    return { worktreePath: validateWorktreePath(repo, requestedWorktreePath), branch: null, baseBranch, ownWorktree: false };
  }

  const branch = `hydra/${workbenchId}`;
  const worktreePath = path.join(repo, ".worktrees", workbenchId);
  execFileSync("git", buildGitWorktreeAddArgs(branch, worktreePath, baseBranch), { cwd: repo, encoding: "utf-8" });
  const project = findProjectByPath(repo);
  if (project) { projectRescan(project.id); } else { syncProjectFn(deps)(repo); }
  return { worktreePath, branch, baseBranch, ownWorktree: true };
}

// --- Loading helpers ---

function loadWorkbenchOrThrow(repoPath: string, workbenchId: string): WorkbenchRecord {
  const workbench = loadWorkbench(repoPath, workbenchId);
  if (!workbench) {
    throw new HydraError(`Workbench not found: ${workbenchId}`, {
      errorCode: "WORKBENCH_NOT_FOUND", stage: "workbench.load", ids: { workbench_id: workbenchId },
    });
  }
  return workbench;
}

function managerForWorkbench(workbench: WorkbenchRecord): AssignmentManager {
  return new AssignmentManager(workbench.repo_path, workbench.id);
}

function loadAssignmentByIdOrThrow(manager: AssignmentManager, workbench: WorkbenchRecord, assignmentId: string): AssignmentRecord {
  const assignment = manager.load(assignmentId);
  if (!assignment) {
    throw new HydraError(`Assignment not found: ${assignmentId}`, {
      errorCode: "WORKBENCH_ASSIGNMENT_NOT_FOUND", stage: "workbench.load_assignment",
      ids: { workbench_id: workbench.id, assignment_id: assignmentId },
    });
  }
  return assignment;
}

function latestRun(assignment: AssignmentRecord): AssignmentRecord["runs"][number] | null {
  if (assignment.runs.length === 0) return null;
  const active = assignment.active_run_id
    ? assignment.runs.find((r) => r.id === assignment.active_run_id) : null;
  return active ?? assignment.runs[assignment.runs.length - 1] ?? null;
}

async function destroyAssignmentTerminal(
  repoPath: string,
  assignment: AssignmentRecord,
  deps?: WorkbenchDependencies,
): Promise<void> {
  const run = latestRun(assignment);
  if (!run?.terminal_id) return;

  // Capture session info from telemetry BEFORE destroying — the terminal
  // process dies but the Claude/Codex session file persists on disk.
  // Storing the session_id lets a future dispatch resume the same context.
  if (!run.session_id) {
    try {
      const telemetry = telemetryTerminal(run.terminal_id);
      if (telemetry?.session_id) {
        run.session_id = telemetry.session_id;
        run.session_file = telemetry.session_file;
        run.session_provider = telemetry.provider;
        const manager = new AssignmentManager(repoPath, assignment.workbench_id);
        manager.save(assignment);
      }
    } catch {}
  }

  try { destroyTerminalFn(deps)(run.terminal_id); } catch {}
}


// --- Dispatch helper ---

// Find the most recent prior run that captured a session_id, so a redispatch
// can resume the same agent context. Only applies to claude (the only agent
// type that currently supports session resumption).
function findResumableSessionId(
  assignment: AssignmentRecord,
): string | undefined {
  if (assignment.requested_agent_type !== "claude") return undefined;
  for (let i = assignment.runs.length - 1; i >= 0; i--) {
    const candidate = assignment.runs[i];
    if (candidate?.session_id) return candidate.session_id;
  }
  return undefined;
}

function buildDispatchRequest(
  workbench: WorkbenchRecord, assignment: AssignmentRecord, disp: Dispatch, runId: string,
): DispatchCreateOnlyRequest {
  return {
    workbenchId: workbench.id, assignmentId: assignment.id, runId,
    repoPath: workbench.repo_path,
    worktreePath: disp.worktree_path ?? workbench.worktree_path,
    agentType: assignment.requested_agent_type,
    model: disp.model,
    reasoningEffort: disp.reasoning_effort,
    taskFile: getRunTaskFile(workbench.repo_path, workbench.id, assignment.id, runId),
    resultFile: getRunResultFile(workbench.repo_path, workbench.id, assignment.id, runId),
    autoApprove: workbench.auto_approve,
    parentTerminalId: workbench.lead_terminal_id,
    resumeSessionId: findResumableSessionId(assignment),
  };
}

async function dispatchAssignment(
  workbench: WorkbenchRecord, assignment: AssignmentRecord, disp: Dispatch,
  runId: string, deps?: WorkbenchDependencies,
): Promise<{ status: "dispatched" | "failed"; terminalId?: string; failure?: WorkbenchFailure }> {
  const now = nowFn(deps);
  const sleep = sleepFn(deps);
  const manager = managerForWorkbench(workbench);
  const stateMachine = new AssignmentStateMachine(manager, { now });
  const tickId = `tick:${workbench.id}:${now()}`;

  // Honor retry backoff: scheduleRetry stamps next_retry_at when a policy
  // configures initial_interval_ms. Wait inline before claiming so the
  // dispatch never beats the policy.
  if (assignment.next_retry_at) {
    const waitMs = Date.parse(assignment.next_retry_at) - Date.parse(now());
    if (waitMs > 0) await sleep(waitMs);
  }

  const claim = await stateMachine.claimPending(assignment.id, tickId);
  if (!claim.changed) return { status: "failed", failure: { code: "CLAIM_FAILED", message: "Could not claim assignment", stage: "workbench.dispatch" } };

  // Checkpoint: snapshot worktree state before agent starts
  const worktreePath = disp.worktree_path ?? workbench.worktree_path;
  let checkpoint: CheckpointResult | undefined;
  try {
    checkpoint = createCheckpointFn(deps)(worktreePath, runId);
    appendLedger(workbench.repo_path, workbench.id, "system", {
      type: "checkpoint_created",
      dispatch_id: assignment.id, run_id: runId,
      sha: checkpoint.sha, head_sha: checkpoint.head_sha, was_dirty: checkpoint.was_dirty,
    });
  } catch {
    // Checkpoint failure is non-fatal — dispatch proceeds without rollback capability
  }

  const taskSpec = buildTaskSpecFromIntent({ workbench, dispatch: disp, assignment, runId });
  let dispatchedTerminalId: string | undefined;
  try {
    const runArtifacts = writeRunTask(taskSpec);
    const dispatchResult = await dispatchFn(deps)(buildDispatchRequest(workbench, assignment, disp, runId));
    dispatchedTerminalId = dispatchResult.terminalId;
    registerDispatchAttempt(manager, assignment.id, {
      runId, terminalId: dispatchResult.terminalId, agentType: dispatchResult.terminalType as AgentType,
      prompt: dispatchResult.prompt, taskFile: runArtifacts.task_file, resultFile: runArtifacts.result_file,
      artifactDir: runArtifacts.artifact_dir, startedAt: now(),
      checkpoint,
    });
    await stateMachine.markInProgress(assignment.id, { tickId, runId });
    return { status: "dispatched", terminalId: dispatchResult.terminalId };
  } catch (error) {
    if (dispatchedTerminalId) { try { destroyTerminalFn(deps)(dispatchedTerminalId); } catch {} }
    const failure: WorkbenchFailure = {
      code: "ASSIGNMENT_DISPATCH_FAILED",
      message: error instanceof Error ? error.message : String(error),
      stage: "workbench.dispatch",
    };
    try { await stateMachine.markFailed(assignment.id, failure); } catch {}
    return { status: "failed", failure };
  }
}

// --- Dispatch status snapshot for DecisionPoint ---

function buildDispatchesSummary(workbench: WorkbenchRecord): DecisionPoint["dispatches"] {
  return Object.entries(workbench.dispatches).map(([id, disp]) => ({
    dispatch_id: id, role: disp.role, status: disp.status,
  }));
}

// ============================================================
// Public API
// ============================================================

// --- initWorkbench ---

export interface InitWorkbenchOptions {
  intent: string;
  repoPath: string;
  worktreePath?: string;
  defaultTimeoutMinutes?: number;
  defaultMaxRetries?: number;
  autoApprove?: boolean;
  /**
   * Optional workbench-level shared context. These fields are persisted on
   * the WorkbenchRecord and broadcast to every dispatched task's task.md
   * under a `## Workflow Context` section. They exist so Dev and Reviewer
   * can see the wider picture (the original human ask, Lead's overall plan,
   * workbench-wide constraints) instead of working from only their local
   * dispatch intent.
   */
  humanRequest?: string;
  overallPlan?: string;
  sharedConstraints?: string[];
}

export interface InitWorkbenchResult {
  workbench_id: string;
  worktree_path: string;
  branch: string | null;
  base_branch: string;
}

export async function initWorkbench(
  options: InitWorkbenchOptions, deps?: WorkbenchDependencies,
): Promise<InitWorkbenchResult> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workbenchId = generateWorkbenchId();

  // Lead identity comes from the calling terminal. Without it, the workbench
  // has no owner and lead-guard cannot enforce single-Lead semantics.
  const leadTerminalId = process.env.TERMCANVAS_TERMINAL_ID;
  if (!leadTerminalId) {
    throw new HydraError(
      "Cannot init workbench: TERMCANVAS_TERMINAL_ID is not set. The Lead must be a TermCanvas terminal.",
      { errorCode: "WORKBENCH_NO_LEAD", stage: "workbench.init" },
    );
  }

  const workspace = prepareWorkbenchWorkspace(repoPath, workbenchId, options.worktreePath, deps);
  const intentFile = writeWorkbenchIntent(repoPath, workbenchId, options.intent);

  const workbench: WorkbenchRecord = {
    schema_version: WORKBENCH_STATE_SCHEMA_VERSION,
    id: workbenchId,
    lead_terminal_id: leadTerminalId,
    intent_file: path.relative(repoPath, intentFile),
    repo_path: repoPath,
    worktree_path: workspace.worktreePath,
    branch: workspace.branch,
    base_branch: workspace.baseBranch,
    own_worktree: workspace.ownWorktree,
    created_at: now(), updated_at: now(),
    status: "active",
    dispatches: {},
    default_timeout_minutes: options.defaultTimeoutMinutes ?? 30,
    default_max_retries: options.defaultMaxRetries ?? 1,
    auto_approve: options.autoApprove ?? true,
    ...(options.humanRequest ? { human_request: options.humanRequest } : {}),
    ...(options.overallPlan ? { overall_plan: options.overallPlan } : {}),
    ...(options.sharedConstraints && options.sharedConstraints.length > 0
      ? { shared_constraints: options.sharedConstraints }
      : {}),
  };
  saveWorkbench(workbench);
  appendLedger(repoPath, workbenchId, "lead", {
    type: "workbench_created",
    intent_file: workbench.intent_file,
    lead_terminal_id: leadTerminalId,
  });

  return {
    workbench_id: workbenchId,
    worktree_path: workspace.worktreePath,
    branch: workspace.branch,
    base_branch: workspace.baseBranch,
  };
}

// --- dispatch ---

export interface DispatchOptions {
  repoPath: string;
  workbenchId: string;
  dispatchId: string;
  /**
   * Role name from the registry (e.g. "dev", "reviewer").
   * The role file's terminals[] array locks cli/model/reasoning_effort —
   * there is no caller-supplied agent_type override.
   */
  role: string;
  intent: string;
  /**
   * Optional model override that takes precedence over the role file's
   * frontmatter `model`. Validated against the resolved CLI adapter at
   * dispatch time.
   */
  model?: string;
  contextRefs?: Array<{ label: string; path: string }>;
  feedback?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  timeoutMinutes?: number;
  maxRetries?: number;
  /**
   * Declarative retry policy for this dispatch. When set, takes precedence over
   * maxRetries and enables exponential backoff + non-retryable error codes.
   */
  retryPolicy?: RetryPolicy;
  /**
   * Lead's pre-dispatch assessment for this dispatch.
   * Recorded in the ledger for audit. Not enforced by Hydra — the Lead
   * is trusted to self-assess and choose the right intervention mode.
   */
  assessment?: LeadAssessment;
}

export interface DispatchResult {
  dispatch_id: string;
  status: "dispatched" | "failed";
  terminal_id?: string;
  failure?: WorkbenchFailure;
}

export async function dispatch(
  options: DispatchOptions, deps?: WorkbenchDependencies,
): Promise<DispatchResult> {
  const repoPath = path.resolve(options.repoPath);
  const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
  ensureLeadCaller(workbench);

  if (workbench.status !== "active") {
    throw new HydraError(`Workbench is not active: ${workbench.status}`, {
      errorCode: "WORKBENCH_NOT_ACTIVE", stage: "workbench.dispatch", ids: { workbench_id: workbench.id },
    });
  }
  if (workbench.dispatches[options.dispatchId]) {
    throw new HydraError(`Dispatch already exists: ${options.dispatchId}`, {
      errorCode: "WORKBENCH_DISPATCH_EXISTS", stage: "workbench.dispatch", ids: { workbench_id: workbench.id },
    });
  }

  // Resolve role from registry and pick the first terminal whose CLI is a
  // supported agent type. Walk terminals[] in order (preference list) and
  // fall back if the preferred CLI is unsupported.
  const role = loadRole(options.role, repoPath);
  const supportedSet = new Set<string>(SUPPORTED_AGENT_TYPES);
  let chosenTerminal: RoleTerminal | undefined;
  for (const terminal of role.terminals) {
    if (supportedSet.has(terminal.cli)) {
      chosenTerminal = terminal;
      break;
    }
    console.error(`hydra: role "${options.role}" terminal cli="${terminal.cli}" is not a supported agent type, trying next`);
  }
  if (!chosenTerminal) {
    throw new HydraError(
      `Role "${options.role}" has no terminal with a supported CLI (tried: ${role.terminals.map(t => t.cli).join(", ")})`,
      { errorCode: "WORKBENCH_NO_SUPPORTED_CLI", stage: "workbench.dispatch", ids: { workbench_id: workbench.id } },
    );
  }
  const agentType = chosenTerminal.cli as AgentType;
  const model = options.model ?? chosenTerminal.model;
  const reasoningEffort = chosenTerminal.reasoning_effort;

  // Create dispatch — write intent to dispatches/{id}/intent.md
  const intentFileAbs = writeDispatchIntent(repoPath, workbench.id, options.dispatchId, options.role, options.intent);
  let feedbackFileRel: string | undefined;
  if (options.feedback) {
    const feedbackAbs = writeDispatchFeedback(repoPath, workbench.id, options.dispatchId, options.feedback);
    feedbackFileRel = path.relative(repoPath, feedbackAbs);
  }

  const disp: Dispatch = {
    id: options.dispatchId, role: options.role, agent_type: agentType,
    model,
    reasoning_effort: reasoningEffort,
    status: "eligible",
    intent_file: path.relative(repoPath, intentFileAbs),
    feedback_file: feedbackFileRel,
    context_refs: options.contextRefs,
    worktree_path: options.worktreePath, worktree_branch: options.worktreeBranch,
    timeout_minutes: options.timeoutMinutes ?? workbench.default_timeout_minutes,
    max_retries: options.maxRetries ?? workbench.default_max_retries,
    retry_policy: options.retryPolicy,
  };

  // Create assignment — snapshot the retry_policy onto the assignment so the
  // state machine never has to load the workbench to make retry decisions.
  // Use dispatchId as the assignment ID directly.
  const manager = managerForWorkbench(workbench);
  manager.create({
    id: options.dispatchId, workbench_id: workbench.id,
    worktree_path: disp.worktree_path ?? workbench.worktree_path,
    role: options.role,
    requested_agent_type: agentType,
    timeout_minutes: disp.timeout_minutes ?? workbench.default_timeout_minutes,
    max_retries: disp.max_retries ?? workbench.default_max_retries,
    retry_policy: disp.retry_policy,
  });

  // Register dispatch
  workbench.dispatches[options.dispatchId] = disp;

  appendLedger(repoPath, workbench.id, "lead", {
    type: "dispatch_started", dispatch_id: options.dispatchId, role: options.role,
    agent_type: agentType, intent_file: disp.intent_file,
    cause: "initial",
    ...(options.assessment ? { assessment: options.assessment } : {}),
  });

  const assignment = loadAssignmentByIdOrThrow(manager, workbench, options.dispatchId);
  const runId = generateRunId();
  const result = await dispatchAssignment(workbench, assignment, disp, runId, deps);
  if (result.status === "dispatched") {
    workbench.dispatches[options.dispatchId].status = "dispatched";
    saveWorkbench(workbench);
    return { dispatch_id: options.dispatchId, status: "dispatched", terminal_id: result.terminalId };
  }
  workbench.dispatches[options.dispatchId].status = "failed";
  workbench.failure = result.failure;
  saveWorkbench(workbench);
  return { dispatch_id: options.dispatchId, status: "failed", failure: result.failure };
}

// --- redispatch ---

export interface RedispatchOptions {
  repoPath: string;
  workbenchId: string;
  dispatchId: string;
  intent?: string;
}

export async function redispatch(
  options: RedispatchOptions, deps?: WorkbenchDependencies,
): Promise<DispatchResult> {
  const repoPath = path.resolve(options.repoPath);
  const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
  ensureLeadCaller(workbench);
  const disp = workbench.dispatches[options.dispatchId];

  if (!disp) {
    throw new HydraError(`Dispatch not found: ${options.dispatchId}`, {
      errorCode: "WORKBENCH_DISPATCH_NOT_FOUND", stage: "workbench.redispatch", ids: { workbench_id: workbench.id },
    });
  }

  const currentStatus = disp.status;
  if (currentStatus !== "eligible" && currentStatus !== "reset") {
    throw new HydraError(`Dispatch "${options.dispatchId}" is not eligible for redispatch (status: ${currentStatus})`, {
      errorCode: "WORKBENCH_DISPATCH_NOT_ELIGIBLE", stage: "workbench.redispatch", ids: { workbench_id: workbench.id },
    });
  }

  // Update intent if provided — overwrite the intent file
  if (options.intent) {
    const intentAbs = writeDispatchIntent(repoPath, workbench.id, options.dispatchId, disp.role, options.intent);
    disp.intent_file = path.relative(repoPath, intentAbs);
  }

  const manager = managerForWorkbench(workbench);
  const assignment = loadAssignmentByIdOrThrow(manager, workbench, options.dispatchId);
  const runId = generateRunId();

  appendLedger(repoPath, workbench.id, "lead", {
    type: "dispatch_started", dispatch_id: options.dispatchId, role: disp.role,
    agent_type: disp.agent_type, intent_file: disp.intent_file,
    cause: "lead_redispatch",
  });

  const result = await dispatchAssignment(workbench, assignment, disp, runId, deps);
  if (result.status === "dispatched") {
    workbench.dispatches[options.dispatchId].status = "dispatched";
    saveWorkbench(workbench);
    return { dispatch_id: options.dispatchId, status: "dispatched", terminal_id: result.terminalId };
  }

  workbench.dispatches[options.dispatchId].status = "failed";
  workbench.failure = result.failure;
  saveWorkbench(workbench);
  return { dispatch_id: options.dispatchId, status: "failed", failure: result.failure };
}

// --- watchUntilDecision ---

export interface WatchOptions {
  repoPath: string;
  workbenchId: string;
  intervalMs?: number;
  timeoutMs?: number;
}

export async function watchUntilDecision(
  options: WatchOptions, deps?: WorkbenchDependencies,
): Promise<DecisionPoint> {
  const now = nowFn(deps);
  const sleep = sleepFn(deps);
  const intervalMs = options.intervalMs ?? 5000;
  const startedAt = Date.parse(now());
  const repoPath = path.resolve(options.repoPath);

  // Guard once outside the loop — Lead identity doesn't change mid-watch
  ensureLeadCaller(loadWorkbenchOrThrow(repoPath, options.workbenchId));

  while (true) {
    const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
    if (workbench.status !== "active") {
      return { type: "batch_completed", workbench_id: workbench.id, timestamp: now(), dispatches: buildDispatchesSummary(workbench) };
    }

    const manager = managerForWorkbench(workbench);
    const stateMachine = new AssignmentStateMachine(manager, { now });
    let changed = false;

    // Phase 1: Check dispatched dispatches for results
    for (const [dispatchId, disp] of Object.entries(workbench.dispatches)) {
      if (disp.status !== "dispatched") continue;
      const assignment = manager.load(dispatchId);
      if (!assignment) continue;

      // Handle pending assignments that were promoted to eligible but not yet dispatched by Lead
      if (assignment.status === "pending") {
        const runId = generateRunId();
        const result = await dispatchAssignment(workbench, assignment, disp, runId, deps);
        if (result.status === "dispatched") { changed = true; }
        else { workbench.dispatches[dispatchId].status = "failed"; }
        saveWorkbench(workbench);
        continue;
      }

      if (assignment.status !== "claimed" && assignment.status !== "in_progress") {
        // Sync dispatch status from completed/failed assignments
        if (assignment.status === "completed") { workbench.dispatches[dispatchId].status = "completed"; changed = true; }
        if (assignment.status === "failed" || assignment.status === "timed_out") { workbench.dispatches[dispatchId].status = "failed"; changed = true; }
        saveWorkbench(workbench);
        continue;
      }

      const run = latestRun(assignment);
      if (!run) continue;

      const collected = collectRunResult({
        workbench_id: workbench.id, assignment_id: assignment.id,
        run_id: run.id, result_file: run.result_file,
      });

      if (collected.status === "completed") {
        // Route by outcome: error -> Hydra retries automatically, completed/stuck -> report to Lead
        if (collected.result.outcome === "error") {
          const errorMessage = `Agent reported error in ${collected.result.report_file}`;
          await stateMachine.markTimedOut(assignment.id, {
            code: "AGENT_REPORTED_ERROR",
            message: errorMessage,
            stage: "workbench.agent_error",
          });
          const retryResult = await stateMachine.scheduleRetry(assignment.id);
          if (retryResult.assignment.status === "failed") {
            workbench.dispatches[dispatchId].status = "failed";
            const durationMs = run.started_at ? Date.parse(now()) - Date.parse(run.started_at) : 0;
            appendLedger(repoPath, workbench.id, "system", {
              type: "dispatch_failed", dispatch_id: dispatchId, role: disp.role, agent_type: disp.agent_type,
              duration_ms: durationMs, retries_used: assignment.retry_count + 1,
              failure_code: "AGENT_REPORTED_ERROR",
              failure_message: errorMessage,
              report_file: collected.result.report_file,
            });
            saveWorkbench(workbench);
            return {
              type: "dispatch_failed_final", workbench_id: workbench.id, timestamp: now(),
              failed: {
                dispatch_id: dispatchId, role: disp.role, code: "AGENT_REPORTED_ERROR",
                message: errorMessage,
                retries_used: assignment.retry_count + 1, max_retries: assignment.max_retries,
              },
              dispatches: buildDispatchesSummary(workbench),
            };
          }
          // Retry scheduled — log the system decision then re-dispatch
          appendLedger(repoPath, workbench.id, "system", {
            type: "dispatch_retried",
            dispatch_id: dispatchId,
            cause: "agent_reported_error",
            attempt: retryResult.assignment.retry_count + 1,
            max_attempts:
              (retryResult.assignment.retry_policy?.maximum_attempts
                ?? retryResult.assignment.max_retries + 1),
            next_retry_at: retryResult.assignment.next_retry_at,
            failure_code: "AGENT_REPORTED_ERROR",
            failure_message: errorMessage,
          });
          await destroyAssignmentTerminal(repoPath, assignment, deps);
          // Rollback worktree to pre-dispatch state before retry
          if (run.checkpoint) {
            try {
              rollbackToCheckpointFn(deps)(disp.worktree_path ?? workbench.worktree_path, run.checkpoint);
              appendLedger(repoPath, workbench.id, "system", {
                type: "checkpoint_rollback", dispatch_id: dispatchId, run_id: run.id,
                target_sha: run.checkpoint.head_sha, cause: "system_retry",
              });
            } catch { /* rollback failure is non-fatal — retry proceeds with dirty state */ }
          }
          const retryRunId = generateRunId();
          const freshAssignment = loadAssignmentByIdOrThrow(manager, workbench, assignment.id);
          appendLedger(repoPath, workbench.id, "system", {
            type: "dispatch_started", dispatch_id: dispatchId, role: disp.role,
            agent_type: disp.agent_type, intent_file: disp.intent_file,
            cause: "system_retry",
          });
          await dispatchAssignment(workbench, freshAssignment, disp, retryRunId, deps);
          saveWorkbench(workbench);
          continue;
        }

        // outcome is "completed" or "stuck" — report to Lead
        const mappedResult = {
          outcome: collected.result.outcome,
          report_file: collected.result.report_file,
          completed_at: now(),
        };
        await stateMachine.markCompleted(assignment.id, mappedResult);
        await destroyAssignmentTerminal(repoPath, assignment, deps);
        workbench.dispatches[dispatchId].status = "completed";

        // Reload assignment to get the captured session_id (set by destroyAssignmentTerminal)
        const reloadedAssignment = manager.load(assignment.id);
        const reloadedRun = reloadedAssignment?.runs.find((r) => r.id === run.id);
        const sessionId = reloadedRun?.session_id;

        const durationMs = run.started_at ? Date.parse(now()) - Date.parse(run.started_at) : 0;
        appendLedger(repoPath, workbench.id, "worker", {
          type: "dispatch_completed", dispatch_id: dispatchId, role: disp.role, agent_type: disp.agent_type,
          duration_ms: durationMs, retries_used: assignment.retry_count,
          outcome: collected.result.outcome,
          stuck_reason: collected.result.stuck_reason,
          report_file: collected.result.report_file,
          session_id: sessionId,
        });

        saveWorkbench(workbench);
        return {
          type: "dispatch_completed", workbench_id: workbench.id, timestamp: now(),
          completed: {
            dispatch_id: dispatchId, role: disp.role,
            outcome: collected.result.outcome,
            stuck_reason: collected.result.stuck_reason,
            report_file: collected.result.report_file,
            duration_ms: durationMs,
            retries_used: assignment.retry_count,
            session: sessionId && reloadedRun?.session_provider
              ? { provider: reloadedRun.session_provider, id: sessionId, file: reloadedRun.session_file }
              : undefined,
          },
          dispatches: buildDispatchesSummary(workbench),
        };
      }

      if (collected.status === "failed") {
        await stateMachine.markFailed(assignment.id, collected.failure);
        workbench.dispatches[dispatchId].status = "failed";
        const durationMs = run.started_at ? Date.parse(now()) - Date.parse(run.started_at) : 0;
        appendLedger(repoPath, workbench.id, "system", {
          type: "dispatch_failed", dispatch_id: dispatchId, role: disp.role, agent_type: disp.agent_type,
          duration_ms: durationMs, retries_used: assignment.retry_count,
          failure_code: collected.failure.code,
          failure_message: collected.failure.message,
        });
        saveWorkbench(workbench);
        return {
          type: "dispatch_failed", workbench_id: workbench.id, timestamp: now(),
          failed: {
            dispatch_id: dispatchId, role: disp.role, code: collected.failure.code,
            message: collected.failure.message,
            retries_used: assignment.retry_count, max_retries: assignment.max_retries,
          },
          dispatches: buildDispatchesSummary(workbench),
        };
      }

      // Still waiting — check terminal health
      const alive = checkTerminalAliveFn(deps)(run.terminal_id);
      if (alive === false) {
        const elapsedMs = run.started_at ? Date.parse(now()) - Date.parse(run.started_at) : 0;
        if (elapsedMs > SPAWN_GRACE_PERIOD_MS) {
          await destroyAssignmentTerminal(repoPath, assignment, deps);
          await stateMachine.markTimedOut(assignment.id, {
            code: "ASSIGNMENT_PROCESS_EXITED",
            message: `Agent process exited without writing result (${Math.round(elapsedMs / 1000)}s)`,
            stage: "workbench.health_check",
          });
          const retryResult = await stateMachine.scheduleRetry(assignment.id);
          if (retryResult.assignment.status === "failed") {
            workbench.dispatches[dispatchId].status = "failed";
            appendLedger(repoPath, workbench.id, "system", {
              type: "dispatch_failed", dispatch_id: dispatchId, role: disp.role, agent_type: disp.agent_type,
              duration_ms: elapsedMs, retries_used: assignment.retry_count + 1,
              failure_code: "ASSIGNMENT_PROCESS_EXITED",
              failure_message: `Agent process exited without writing result (${Math.round(elapsedMs / 1000)}s)`,
            });
            saveWorkbench(workbench);
            return {
              type: "dispatch_failed_final", workbench_id: workbench.id, timestamp: now(),
              failed: {
                dispatch_id: dispatchId, role: disp.role, code: "ASSIGNMENT_PROCESS_EXITED",
                message: "Agent process exited and retry limit reached",
                retries_used: assignment.retry_count + 1, max_retries: assignment.max_retries,
              },
              dispatches: buildDispatchesSummary(workbench),
            };
          }
          // Retry scheduled — log the system decision then re-dispatch.
          appendLedger(repoPath, workbench.id, "system", {
            type: "dispatch_retried",
            dispatch_id: dispatchId,
            cause: "timeout",
            attempt: retryResult.assignment.retry_count + 1,
            max_attempts:
              (retryResult.assignment.retry_policy?.maximum_attempts
                ?? retryResult.assignment.max_retries + 1),
            next_retry_at: retryResult.assignment.next_retry_at,
            failure_code: "ASSIGNMENT_PROCESS_EXITED",
            failure_message: `Agent process exited without writing result (${Math.round(elapsedMs / 1000)}s)`,
          });
          // Rollback worktree to pre-dispatch state before retry
          if (run.checkpoint) {
            try {
              rollbackToCheckpointFn(deps)(disp.worktree_path ?? workbench.worktree_path, run.checkpoint);
              appendLedger(repoPath, workbench.id, "system", {
                type: "checkpoint_rollback", dispatch_id: dispatchId, run_id: run.id,
                target_sha: run.checkpoint.head_sha, cause: "system_retry",
              });
            } catch { /* rollback failure is non-fatal */ }
          }
          const retryRunId = generateRunId();
          const freshAssignment = loadAssignmentByIdOrThrow(manager, workbench, assignment.id);
          appendLedger(repoPath, workbench.id, "system", {
            type: "dispatch_started", dispatch_id: dispatchId, role: disp.role,
            agent_type: disp.agent_type, intent_file: disp.intent_file,
            cause: "system_retry",
          });
          const retryOutcome = await dispatchAssignment(workbench, freshAssignment, disp, retryRunId, deps);
          if (retryOutcome.status === "dispatched") { changed = true; }
          saveWorkbench(workbench);
          continue;
        }
      }

      // Check duration timeout
      const freshAssignment = loadAssignmentByIdOrThrow(manager, workbench, assignment.id);
      if (hasAssignmentTimedOut(freshAssignment, now())) {
        // Rollback worktree to pre-dispatch state before timeout retry
        const currentRun = latestRun(freshAssignment);
        if (currentRun?.checkpoint) {
          try {
            rollbackToCheckpointFn(deps)(disp.worktree_path ?? workbench.worktree_path, currentRun.checkpoint);
            appendLedger(repoPath, workbench.id, "system", {
              type: "checkpoint_rollback", dispatch_id: dispatchId, run_id: currentRun.id,
              target_sha: currentRun.checkpoint.head_sha, cause: "timeout_retry",
            });
          } catch { /* rollback failure is non-fatal */ }
        }
        const retryRunId = generateRunId();
        const retrySpec = buildTaskSpecFromIntent({ workbench, dispatch: disp, assignment: freshAssignment, runId: retryRunId });
        const retryArtifacts = writeRunTask(retrySpec);
        const retryOutcome = await retryTimedOutAssignment(
          {
            assignmentId: assignment.id, timeoutCheckedAt: now(),
            dispatchRequest: { ...buildDispatchRequest(workbench, freshAssignment, disp, retryRunId), taskFile: retryArtifacts.task_file, resultFile: retryArtifacts.result_file },
            runId: retryRunId, taskFile: retryArtifacts.task_file, resultFile: retryArtifacts.result_file,
            artifactDir: retryArtifacts.artifact_dir,
          },
          { manager, stateMachine, dispatchCreateOnly: dispatchFn(deps), destroyTerminal: destroyTerminalFn(deps), now },
        );
        if (retryOutcome.status === "failed") {
          workbench.dispatches[dispatchId].status = "failed";
          appendLedger(repoPath, workbench.id, "system", {
            type: "dispatch_failed", dispatch_id: dispatchId, role: disp.role, agent_type: disp.agent_type,
            duration_ms: 0, retries_used: freshAssignment.retry_count + 1,
            failure_code: "ASSIGNMENT_TIMED_OUT",
            failure_message: "Assignment timed out and retry limit reached",
          });
          saveWorkbench(workbench);
          return {
            type: "dispatch_failed_final", workbench_id: workbench.id, timestamp: now(),
            failed: {
              dispatch_id: dispatchId, role: disp.role, code: "ASSIGNMENT_TIMED_OUT",
              message: "Assignment timed out and retry limit reached",
              retries_used: freshAssignment.retry_count + 1, max_retries: freshAssignment.max_retries,
            },
            dispatches: buildDispatchesSummary(workbench),
          };
        }
        // retryTimedOutAssignment scheduled and re-dispatched. Log the
        // system decision so the audit log shows the system retry path.
        const reloadedForLog = manager.load(assignment.id);
        if (reloadedForLog) {
          appendLedger(repoPath, workbench.id, "system", {
            type: "dispatch_retried",
            dispatch_id: dispatchId,
            cause: "timeout",
            attempt: reloadedForLog.retry_count + 1,
            max_attempts:
              (reloadedForLog.retry_policy?.maximum_attempts
                ?? reloadedForLog.max_retries + 1),
            next_retry_at: reloadedForLog.next_retry_at,
            failure_code: "ASSIGNMENT_TIMEOUT",
            failure_message: `Assignment exceeded ${freshAssignment.timeout_minutes}-minute timeout`,
          });
          appendLedger(repoPath, workbench.id, "system", {
            type: "dispatch_started", dispatch_id: dispatchId, role: disp.role,
            agent_type: disp.agent_type, intent_file: disp.intent_file,
            cause: "system_retry",
          });
        }
        changed = true;
        saveWorkbench(workbench);
      }
    }

    // Phase 2: Check if no dispatched dispatches remain (Lead needs to decide next)
    const statuses = Object.values(workbench.dispatches).map(d => d.status);
    const anyDispatched = statuses.includes("dispatched");
    if (!anyDispatched && statuses.length > 0 && !changed) {
      saveWorkbench(workbench);
      return { type: "batch_completed", workbench_id: workbench.id, timestamp: now(), dispatches: buildDispatchesSummary(workbench) };
    }

    // Phase 3: Timeout check
    if (options.timeoutMs !== undefined) {
      const elapsed = Date.parse(now()) - startedAt;
      if (elapsed >= options.timeoutMs) {
        return { type: "watch_timeout", workbench_id: workbench.id, timestamp: now(), dispatches: buildDispatchesSummary(workbench) };
      }
    }

    if (!changed) await sleep(intervalMs);
  }
}

// --- resetDispatch ---

export interface ResetDispatchOptions {
  repoPath: string;
  workbenchId: string;
  dispatchId: string;
  feedback: string;
  /** When true, skip git rollback and preserve the agent's changes. */
  skipRollback?: boolean;
}

export interface ResetDispatchResult {
  dispatch_id: string;
}

export async function resetDispatch(
  options: ResetDispatchOptions, deps?: WorkbenchDependencies,
): Promise<ResetDispatchResult> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
  ensureLeadCaller(workbench);
  const manager = managerForWorkbench(workbench);

  if (!workbench.dispatches[options.dispatchId]) {
    throw new HydraError(`Dispatch not found: ${options.dispatchId}`, {
      errorCode: "WORKBENCH_DISPATCH_NOT_FOUND", stage: "workbench.reset_dispatch", ids: { workbench_id: workbench.id },
    });
  }

  // Reset only the target dispatch — Lead manually resets others if needed
  workbench.dispatches[options.dispatchId].status = "reset";

  const disp = workbench.dispatches[options.dispatchId];
  // Use dispatchId as the assignment ID
  const assignment = manager.load(options.dispatchId);
  if (assignment) {
    await destroyAssignmentTerminal(repoPath, assignment, deps);

    // Rollback worktree to latest checkpoint unless opted out
    if (!options.skipRollback) {
      const latestCheckpointRun = assignment.runs
        .slice()
        .reverse()
        .find((r) => r.checkpoint);
      if (latestCheckpointRun?.checkpoint) {
        try {
          rollbackToCheckpointFn(deps)(disp.worktree_path ?? workbench.worktree_path, latestCheckpointRun.checkpoint);
          appendLedger(repoPath, workbench.id, "system", {
            type: "checkpoint_rollback", dispatch_id: options.dispatchId, run_id: latestCheckpointRun.id,
            target_sha: latestCheckpointRun.checkpoint.head_sha, cause: "lead_reset",
          });
        } catch { /* rollback failure is non-fatal */ }
      }
    }

    const previousStatus = assignment.status;
    assignment.status = "pending";
    assignment.updated_at = now();
    assignment.claim = undefined;
    assignment.last_error = undefined;
    assignment.result = undefined;
    assignment.active_run_id = null;
    assignment.transitions = assignment.transitions ?? [];
    assignment.transitions.push({ event: "requeue_assignment", from: previousStatus, to: "pending", at: now() });
    manager.save(assignment);
  }

  // Store feedback on target dispatch — write feedback.md, store path
  const feedbackAbs = writeDispatchFeedback(repoPath, workbench.id, options.dispatchId, options.feedback);
  const feedbackFileRel = path.relative(repoPath, feedbackAbs);
  workbench.dispatches[options.dispatchId].feedback_file = feedbackFileRel;

  appendLedger(repoPath, workbench.id, "lead", {
    type: "dispatch_reset", dispatch_id: options.dispatchId, role: workbench.dispatches[options.dispatchId].role,
    feedback_file: workbench.dispatches[options.dispatchId].feedback_file,
  });

  workbench.updated_at = now();
  saveWorkbench(workbench);
  return { dispatch_id: options.dispatchId };
}

// --- mergeWorktrees ---

export interface MergeWorktreesOptions {
  repoPath: string;
  workbenchId: string;
  sourceDispatchIds: string[];
  targetBranch?: string;
}

export type MergeOutcome =
  | { status: "merged"; commit_sha: string }
  | { status: "conflict"; conflicting_files: string[] };

export async function mergeWorktrees(
  options: MergeWorktreesOptions, deps?: WorkbenchDependencies,
): Promise<MergeOutcome> {
  const repoPath = path.resolve(options.repoPath);
  const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
  ensureLeadCaller(workbench);

  for (const dispatchId of options.sourceDispatchIds) {
    if (workbench.dispatches[dispatchId]?.status !== "completed") {
      throw new HydraError(`Dispatch "${dispatchId}" is not completed`, {
        errorCode: "WORKBENCH_MERGE_NOT_READY", stage: "workbench.merge", ids: { workbench_id: workbench.id },
      });
    }
  }

  const targetBranch = options.targetBranch ?? workbench.branch ?? workbench.base_branch;
  const cwd = workbench.worktree_path;

  // Checkout target branch and record HEAD for rollback
  execFileSync("git", ["checkout", targetBranch], { cwd, encoding: "utf-8", stdio: "pipe" });
  const preMergeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", stdio: "pipe" }).trim();

  for (const dispatchId of options.sourceDispatchIds) {
    const disp = workbench.dispatches[dispatchId];
    const branch = disp?.worktree_branch;
    if (!branch) {
      throw new HydraError(`Dispatch "${dispatchId}" has no worktree_branch — cannot merge`, {
        errorCode: "WORKBENCH_MERGE_NO_BRANCH", stage: "workbench.merge", ids: { workbench_id: workbench.id },
      });
    }

    try {
      execFileSync("git", ["merge", "--no-ff", branch, "-m", `Merge ${dispatchId} (${disp.role})`], { cwd, encoding: "utf-8", stdio: "pipe" });
    } catch {
      // Collect conflict info, then roll back ALL merges (not just this one)
      let conflictingFiles: string[] = [];
      try {
        const statusOutput = execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
        conflictingFiles = statusOutput ? statusOutput.split("\n") : [];
        execFileSync("git", ["merge", "--abort"], { cwd, encoding: "utf-8", stdio: "pipe" });
      } catch {}
      // Reset to pre-merge state to undo any partial merges
      try { execFileSync("git", ["reset", "--hard", preMergeHead], { cwd, encoding: "utf-8", stdio: "pipe" }); } catch {}
      appendLedger(repoPath, workbench.id, "lead", { type: "merge_attempted", source_dispatches: options.sourceDispatchIds, outcome: "conflict" });
      return { status: "conflict", conflicting_files: conflictingFiles };
    }
  }

  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
  appendLedger(repoPath, workbench.id, "lead", { type: "merge_attempted", source_dispatches: options.sourceDispatchIds, outcome: "merged" });
  return { status: "merged", commit_sha: commitSha };
}

// --- approveDispatch ---

export interface ApproveDispatchOptions {
  repoPath: string;
  workbenchId: string;
  dispatchId: string;
}

export async function approveDispatch(options: ApproveDispatchOptions, deps?: WorkbenchDependencies): Promise<void> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
  ensureLeadCaller(workbench);
  const manager = managerForWorkbench(workbench);
  const disp = workbench.dispatches[options.dispatchId];
  if (!disp) {
    throw new HydraError(`Dispatch "${options.dispatchId}" not found`, {
      errorCode: "WORKBENCH_APPROVE_NO_DISPATCH", stage: "workbench.approve", ids: { workbench_id: workbench.id },
    });
  }
  // Use dispatchId as the assignment ID
  const assignment = loadAssignmentByIdOrThrow(manager, workbench, options.dispatchId);
  const run = latestRun(assignment);
  if (!run) {
    throw new HydraError(`Dispatch "${options.dispatchId}" has no run`, {
      errorCode: "WORKBENCH_APPROVE_NO_RUN", stage: "workbench.approve", ids: { workbench_id: workbench.id },
    });
  }

  if (!workbench.approved_refs) workbench.approved_refs = {};
  workbench.approved_refs[options.dispatchId] = {
    assignment_id: assignment.id, run_id: run.id,
    brief_file: getRunReportFile(repoPath, workbench.id, assignment.id, run.id),
    result_file: run.result_file, approved_at: now(),
  };

  appendLedger(repoPath, workbench.id, "lead", { type: "dispatch_approved", dispatch_id: options.dispatchId, role: disp.role });
  workbench.updated_at = now();
  saveWorkbench(workbench);
}

// --- completeWorkbench ---

export async function completeWorkbench(
  options: { repoPath: string; workbenchId: string; summary?: string }, deps?: WorkbenchDependencies,
): Promise<void> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
  ensureLeadCaller(workbench);
  const manager = managerForWorkbench(workbench);

  // Destroy any running terminals (captures session_id before destroy)
  for (const [dispatchId, disp] of Object.entries(workbench.dispatches)) {
    const a = manager.load(dispatchId);
    if (a && (a.status === "claimed" || a.status === "in_progress")) {
      await destroyAssignmentTerminal(repoPath, a, deps);
    }
  }

  // Clean up checkpoint refs — they are no longer needed after completion
  cleanupCheckpointRefs(workbench, manager);

  const totalDuration = Date.parse(now()) - Date.parse(workbench.created_at);
  const totalRetries = Object.keys(workbench.dispatches).reduce((sum, id) => {
    const a = manager.load(id);
    return sum + (a?.retry_count ?? 0);
  }, 0);

  // Write summary file if Lead provided a summary
  let resultFileRel: string | undefined;
  if (options.summary) {
    const summaryAbs = writeWorkbenchSummary(repoPath, workbench.id, options.summary);
    resultFileRel = path.relative(repoPath, summaryAbs);
    workbench.result_file = resultFileRel;
  }

  workbench.status = "completed";
  workbench.failure = undefined;
  workbench.updated_at = now();
  saveWorkbench(workbench);

  appendLedger(repoPath, workbench.id, "lead", {
    type: "workbench_completed",
    result_file: resultFileRel,
    total_duration_ms: totalDuration,
    total_dispatches: Object.keys(workbench.dispatches).length,
    total_retries: totalRetries,
  });
}

// --- failWorkbench ---

export async function failWorkbench(
  options: { repoPath: string; workbenchId: string; reason: string }, deps?: WorkbenchDependencies,
): Promise<void> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
  ensureLeadCaller(workbench);
  const manager = managerForWorkbench(workbench);

  for (const [dispatchId, disp] of Object.entries(workbench.dispatches)) {
    const a = manager.load(dispatchId);
    if (a && (a.status === "claimed" || a.status === "in_progress")) {
      await destroyAssignmentTerminal(repoPath, a, deps);
    }
  }

  // Clean up checkpoint refs
  cleanupCheckpointRefs(workbench, manager);

  const totalDuration = Date.parse(now()) - Date.parse(workbench.created_at);
  // Find the dispatch that bears the visible failure (most recently failed),
  // for the failed_dispatch_id field on the ledger event.
  const failedDispatchId = Object.entries(workbench.dispatches)
    .filter(([, d]) => d.status === "failed")
    .map(([id]) => id)[0];
  workbench.status = "failed";
  workbench.failure = { code: "WORKBENCH_MANUALLY_FAILED", message: options.reason, stage: "workbench.fail" };
  workbench.updated_at = now();
  saveWorkbench(workbench);

  appendLedger(repoPath, workbench.id, "lead", {
    type: "workbench_failed",
    reason: options.reason,
    total_duration_ms: totalDuration,
    failed_dispatch_id: failedDispatchId,
  });
}

// --- checkpoint ref cleanup ---

function cleanupCheckpointRefs(workbench: WorkbenchRecord, manager: AssignmentManager): void {
  const worktreePath = workbench.worktree_path;
  for (const dispatchId of Object.keys(workbench.dispatches)) {
    const a = manager.load(dispatchId);
    if (!a) continue;
    for (const run of a.runs) {
      if (run.checkpoint) {
        removeCheckpointRef(worktreePath, run.id);
      }
    }
  }
}

// --- rollbackDispatch ---

export interface RollbackDispatchOptions {
  repoPath: string;
  workbenchId: string;
  dispatchId: string;
}

export interface RollbackDispatchResult {
  dispatch_id: string;
  rolled_back_to: string;
}

export async function rollbackDispatch(
  options: RollbackDispatchOptions, deps?: WorkbenchDependencies,
): Promise<RollbackDispatchResult> {
  const repoPath = path.resolve(options.repoPath);
  const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
  ensureLeadCaller(workbench);
  const manager = managerForWorkbench(workbench);

  const disp = workbench.dispatches[options.dispatchId];
  if (!disp) {
    throw new HydraError(`Dispatch not found: ${options.dispatchId}`, {
      errorCode: "WORKBENCH_DISPATCH_NOT_FOUND", stage: "workbench.rollback",
      ids: { workbench_id: workbench.id },
    });
  }

  const assignment = loadAssignmentByIdOrThrow(manager, workbench, options.dispatchId);
  const checkpointRun = assignment.runs.slice().reverse().find((r) => r.checkpoint);
  if (!checkpointRun?.checkpoint) {
    throw new HydraError(`No checkpoint found for dispatch "${options.dispatchId}"`, {
      errorCode: "WORKBENCH_NO_CHECKPOINT", stage: "workbench.rollback",
      ids: { workbench_id: workbench.id },
    });
  }

  rollbackToCheckpointFn(deps)(disp.worktree_path ?? workbench.worktree_path, checkpointRun.checkpoint);
  appendLedger(repoPath, workbench.id, "lead", {
    type: "checkpoint_rollback", dispatch_id: options.dispatchId, run_id: checkpointRun.id,
    target_sha: checkpointRun.checkpoint.head_sha, cause: "manual",
  });

  return { dispatch_id: options.dispatchId, rolled_back_to: checkpointRun.checkpoint.head_sha };
}

// --- getWorkbenchStatus ---

export interface WorkbenchStatusView {
  workbench: WorkbenchRecord;
  assignments: AssignmentRecord[];
}

export function getWorkbenchStatus(repoPath: string, workbenchId: string): WorkbenchStatusView {
  const workbench = loadWorkbenchOrThrow(path.resolve(repoPath), workbenchId);
  const manager = managerForWorkbench(workbench);
  const assignments = Object.keys(workbench.dispatches)
    .map((id) => manager.load(id))
    .filter((a): a is AssignmentRecord => a !== null);
  return { workbench, assignments };
}

// --- askDispatch (Lead -> completed dispatch follow-up) ---

export interface AskDispatchOptions {
  repoPath: string;
  workbenchId: string;
  dispatchId: string;
  message: string;
  /** Override the default subprocess timeout (5 minutes). */
  timeoutMs?: number;
}

export interface AskDispatchResult {
  dispatch_id: string;
  role: string;
  cli: AgentType;
  session_id: string;
  new_session_id: string | null;
  answer: string;
  duration_ms: number;
  exit_code: number | null;
}

/**
 * Ask a follow-up question to a dispatch that has already completed, without
 * killing or re-dispatching anything. This reuses the dispatch's saved
 * session_id to spin up a one-shot non-interactive subprocess that
 * loads the prior conversation, answers the question, and exits.
 *
 * Why this exists:
 *   - `hydra reset --feedback` is the heavyweight intervention: it kills
 *     the running worker, discards its session, and respawns a new one
 *     from task.md with the Lead's feedback. That's the right tool when
 *     the dispatch needs to actually redo work.
 *   - `hydra ask` is the lightweight intervention: just a question-and-
 *     answer round with the already-completed dispatch, leaving the workbench
 *     state completely unchanged.
 *
 * Prerequisites:
 *   - The dispatch must have completed at least one run (it needs a
 *     session_id captured by telemetry).
 *   - The session provider must be claude or codex (other CLIs have no
 *     resume contract).
 *   - For claude, the subprocess uses --fork-session so the original
 *     session file stays pristine.
 *   - For codex, the subprocess uses `codex exec resume` which appends
 *     to the original session (no headless fork yet; see openai/codex#13537).
 */
export async function askDispatch(
  options: AskDispatchOptions,
  deps?: WorkbenchDependencies,
): Promise<AskDispatchResult> {
  const repoPath = path.resolve(options.repoPath);
  const workbench = loadWorkbenchOrThrow(repoPath, options.workbenchId);
  ensureLeadCaller(workbench);
  const disp = workbench.dispatches[options.dispatchId];
  if (!disp) {
    throw new HydraError(
      `Dispatch not found: ${options.dispatchId}`,
      {
        errorCode: "ASK_DISPATCH_NOT_FOUND",
        stage: "ask.preflight",
        ids: { workbench_id: workbench.id, dispatch_id: options.dispatchId },
      },
    );
  }
  // Use dispatchId as the assignment ID
  const manager = managerForWorkbench(workbench);
  const assignment = manager.load(options.dispatchId);
  if (!assignment) {
    throw new HydraError(
      `Assignment for dispatch ${options.dispatchId} not found`,
      {
        errorCode: "ASK_ASSIGNMENT_MISSING",
        stage: "ask.preflight",
        ids: { workbench_id: workbench.id, dispatch_id: options.dispatchId },
      },
    );
  }
  const latestRunRecord = assignment.runs[assignment.runs.length - 1];
  if (!latestRunRecord) {
    throw new HydraError(
      `Dispatch ${options.dispatchId} has no runs yet`,
      {
        errorCode: "ASK_NO_RUNS",
        stage: "ask.preflight",
        ids: { workbench_id: workbench.id, dispatch_id: options.dispatchId },
      },
    );
  }
  const sessionId = latestRunRecord.session_id;
  if (!sessionId) {
    throw new HydraError(
      `Dispatch ${options.dispatchId} has no session_id captured yet — ask requires a completed or in-progress session`,
      {
        errorCode: "ASK_NO_SESSION",
        stage: "ask.preflight",
        ids: { workbench_id: workbench.id, dispatch_id: options.dispatchId, run_id: latestRunRecord.id },
      },
    );
  }
  if (latestRunRecord.agent_type !== "claude" && latestRunRecord.agent_type !== "codex") {
    throw new HydraError(
      `hydra ask supports only claude|codex sessions, got: ${latestRunRecord.agent_type}`,
      {
        errorCode: "ASK_UNSUPPORTED_CLI",
        stage: "ask.preflight",
        ids: { workbench_id: workbench.id, dispatch_id: options.dispatchId },
      },
    );
  }

  const ask = deps?.askFollowUp ?? askFollowUp;
  const result = await ask({
    cli: latestRunRecord.agent_type,
    sessionId,
    message: options.message,
    workdir: workbench.worktree_path,
    timeoutMs: options.timeoutMs,
  });

  // Ledger record: who asked what, how long, what came back. Excerpts
  // are capped to keep the ledger scannable.
  const excerpt = (text: string, max: number): string => {
    const trimmed = text.trim();
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
  };
  appendLedger(repoPath, workbench.id, "lead", {
    type: "lead_asked_followup",
    dispatch_id: options.dispatchId,
    role: disp.role,
    agent_type: latestRunRecord.agent_type,
    session_id: sessionId,
    new_session_id: result.newSessionId ?? undefined,
    message_excerpt: excerpt(options.message, 200),
    answer_excerpt: excerpt(result.answer, 400),
    duration_ms: result.durationMs,
  });

  return {
    dispatch_id: options.dispatchId,
    role: disp.role,
    cli: latestRunRecord.agent_type,
    session_id: sessionId,
    new_session_id: result.newSessionId,
    answer: result.answer,
    duration_ms: result.durationMs,
    exit_code: result.exitCode,
  };
}
