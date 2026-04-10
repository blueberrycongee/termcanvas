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
import { resolveDefaultAgentType } from "./agent-selection.ts";
import {
  registerDispatchAttempt,
  hasAssignmentTimedOut,
  retryTimedOutAssignment,
} from "./retry.ts";
import { writeRunTask } from "./run-task.ts";
import { buildTaskSpecFromIntent } from "./task-spec-builder.ts";
import {
  clearNodeFeedback,
  writeNodeFeedback,
  writeNodeIntent,
  writeWorkflowIntent,
  writeWorkflowSummary,
} from "./artifacts.ts";
import {
  deleteWorkflow,
  loadWorkflow,
  saveWorkflow,
  WORKFLOW_STATE_SCHEMA_VERSION,
  type WorkflowFailure,
  type WorkflowNode,
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
  getNodeFeedbackFile,
  getNodeIntentFile,
  getRunReportFile,
  getRunResultFile,
  getRunTaskFile,
  getWorkflowIntentFile,
  getWorkflowSummaryFile,
} from "./layout.ts";
import { appendLedger } from "./ledger.ts";
import { ensureLeadCaller } from "./lead-guard.ts";
import type { DecisionPoint, NodeStatus } from "./decision.ts";

// --- Constants ---

const SPAWN_GRACE_PERIOD_MS = 15_000;

// --- Dependencies ---

export interface WorkflowDependencies {
  now?: () => string;
  dispatchCreateOnly?: (request: DispatchCreateOnlyRequest) => Promise<DispatchCreateOnlyResult>;
  sleep?: (ms: number) => Promise<void>;
  syncProject?: (repoPath: string) => void;
  destroyTerminal?: (terminalId: string) => void;
  checkTerminalAlive?: (terminalId: string) => boolean | null;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function nowFn(deps?: WorkflowDependencies): () => string {
  return deps?.now ?? (() => new Date().toISOString());
}
function dispatchFn(deps?: WorkflowDependencies) {
  return deps?.dispatchCreateOnly ?? defaultDispatchCreateOnly;
}
function sleepFn(deps?: WorkflowDependencies) {
  return deps?.sleep ?? DEFAULT_SLEEP;
}
function syncProjectFn(deps?: WorkflowDependencies) {
  if (deps?.syncProject) return deps.syncProject;
  if (deps?.dispatchCreateOnly) return (_: string) => {};
  return ensureProjectTracked;
}
function destroyTerminalFn(deps?: WorkflowDependencies) {
  if (deps?.destroyTerminal) return deps.destroyTerminal;
  if (deps?.dispatchCreateOnly) return (_: string) => {};
  return terminalDestroy;
}
function checkTerminalAliveFn(deps?: WorkflowDependencies): (id: string) => boolean | null {
  if (deps?.checkTerminalAlive) return deps.checkTerminalAlive;
  return (_id: string) => {
    try {
      if (!isTermCanvasRunning()) return null;
      return null; // cannot check without telemetry import cycle
    } catch { return null; }
  };
}

// --- ID generation ---

function generateWorkflowId(): string {
  return `workflow-${crypto.randomBytes(6).toString("hex")}`;
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

function prepareWorkflowWorkspace(
  repoPath: string,
  workflowId: string,
  requestedWorktreePath: string | undefined,
  deps?: WorkflowDependencies,
): { worktreePath: string; branch: string | null; baseBranch: string; ownWorktree: boolean } {
  const repo = path.resolve(repoPath);
  const baseBranch = getCurrentBranch(repo);

  if (requestedWorktreePath) {
    syncProjectFn(deps)(repo);
    return { worktreePath: validateWorktreePath(repo, requestedWorktreePath), branch: null, baseBranch, ownWorktree: false };
  }

  const branch = `hydra/${workflowId}`;
  const worktreePath = path.join(repo, ".worktrees", workflowId);
  execFileSync("git", buildGitWorktreeAddArgs(branch, worktreePath, baseBranch), { cwd: repo, encoding: "utf-8" });
  const project = findProjectByPath(repo);
  if (project) { projectRescan(project.id); } else { syncProjectFn(deps)(repo); }
  return { worktreePath, branch, baseBranch, ownWorktree: true };
}

// --- Loading helpers ---

function loadWorkflowOrThrow(repoPath: string, workflowId: string): WorkflowRecord {
  const workflow = loadWorkflow(repoPath, workflowId);
  if (!workflow) {
    throw new HydraError(`Workflow not found: ${workflowId}`, {
      errorCode: "WORKFLOW_NOT_FOUND", stage: "workflow.load", ids: { workflow_id: workflowId },
    });
  }
  return workflow;
}

function managerForWorkflow(workflow: WorkflowRecord): AssignmentManager {
  return new AssignmentManager(workflow.repo_path, workflow.id);
}

function loadAssignmentByIdOrThrow(manager: AssignmentManager, workflow: WorkflowRecord, assignmentId: string): AssignmentRecord {
  const assignment = manager.load(assignmentId);
  if (!assignment) {
    throw new HydraError(`Assignment not found: ${assignmentId}`, {
      errorCode: "WORKFLOW_ASSIGNMENT_NOT_FOUND", stage: "workflow.load_assignment",
      ids: { workflow_id: workflow.id, assignment_id: assignmentId },
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
  assignment: AssignmentRecord,
  deps?: WorkflowDependencies,
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
        const manager = new AssignmentManager(assignment.workspace_root ?? "", assignment.workflow_id);
        manager.save(assignment);
      }
    } catch {}
  }

  try { destroyTerminalFn(deps)(run.terminal_id); } catch {}
}

// --- Dependency tracking ---

function allDepsCompleted(workflow: WorkflowRecord, node: WorkflowNode): boolean {
  return node.depends_on.every((depId) => workflow.node_statuses[depId] === "completed");
}

function promoteEligibleNodes(workflow: WorkflowRecord): string[] {
  const promoted: string[] = [];
  for (const [id, status] of Object.entries(workflow.node_statuses)) {
    if (status !== "blocked") continue;
    const node = workflow.nodes[id];
    if (node && allDepsCompleted(workflow, node)) {
      workflow.node_statuses[id] = "eligible";
      promoted.push(id);
    }
  }
  return promoted;
}

function cascadeReset(workflow: WorkflowRecord, nodeId: string): string[] {
  const resetIds: string[] = [];
  function collect(id: string): void {
    if (resetIds.includes(id)) return;
    resetIds.push(id);
    for (const [childId, childNode] of Object.entries(workflow.nodes)) {
      if (childNode.depends_on.includes(id)) collect(childId);
    }
  }
  collect(nodeId);
  // Target node → eligible (its own deps are already met); downstream → blocked
  for (const id of resetIds) {
    workflow.node_statuses[id] = id === nodeId ? "eligible" : "blocked";
  }
  return resetIds;
}

function hasCycle(workflow: WorkflowRecord, newNodeId: string, dependsOn: string[]): boolean {
  const visited = new Set<string>();
  function visit(id: string): boolean {
    if (id === newNodeId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    const node = workflow.nodes[id];
    if (!node) return false;
    return node.depends_on.some(visit);
  }
  return dependsOn.some(visit);
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
  workflow: WorkflowRecord, assignment: AssignmentRecord, node: WorkflowNode, runId: string,
): DispatchCreateOnlyRequest {
  return {
    workflowId: workflow.id, assignmentId: assignment.id, runId,
    repoPath: workflow.repo_path,
    worktreePath: node.worktree_path ?? workflow.worktree_path,
    agentType: assignment.requested_agent_type,
    taskFile: getRunTaskFile(workflow.repo_path, workflow.id, assignment.id, runId),
    resultFile: getRunResultFile(workflow.repo_path, workflow.id, assignment.id, runId),
    autoApprove: workflow.auto_approve,
    parentTerminalId: workflow.lead_terminal_id,
    resumeSessionId: findResumableSessionId(assignment),
  };
}

async function dispatchAssignment(
  workflow: WorkflowRecord, assignment: AssignmentRecord, node: WorkflowNode,
  runId: string, deps?: WorkflowDependencies,
): Promise<{ status: "dispatched" | "failed"; terminalId?: string; failure?: WorkflowFailure }> {
  const now = nowFn(deps);
  const manager = managerForWorkflow(workflow);
  const stateMachine = new AssignmentStateMachine(manager, { now });
  const tickId = `tick:${workflow.id}:${now()}`;

  const claim = await stateMachine.claimPending(assignment.id, tickId);
  if (!claim.changed) return { status: "failed", failure: { code: "CLAIM_FAILED", message: "Could not claim assignment", stage: "workflow.dispatch" } };

  const taskSpec = buildTaskSpecFromIntent({ workflow, node, assignment, runId });
  let dispatchedTerminalId: string | undefined;
  try {
    const runArtifacts = writeRunTask(taskSpec);
    const dispatch = await dispatchFn(deps)(buildDispatchRequest(workflow, assignment, node, runId));
    dispatchedTerminalId = dispatch.terminalId;
    registerDispatchAttempt(manager, assignment.id, {
      runId, terminalId: dispatch.terminalId, agentType: dispatch.terminalType as AgentType,
      prompt: dispatch.prompt, taskFile: runArtifacts.task_file, resultFile: runArtifacts.result_file,
      artifactDir: runArtifacts.artifact_dir, startedAt: now(),
    });
    await stateMachine.markInProgress(assignment.id, { tickId, runId });
    return { status: "dispatched", terminalId: dispatch.terminalId };
  } catch (error) {
    if (dispatchedTerminalId) { try { destroyTerminalFn(deps)(dispatchedTerminalId); } catch {} }
    const failure: WorkflowFailure = {
      code: "ASSIGNMENT_DISPATCH_FAILED",
      message: error instanceof Error ? error.message : String(error),
      stage: "workflow.dispatch",
    };
    try { await stateMachine.markFailed(assignment.id, failure); } catch {}
    return { status: "failed", failure };
  }
}

// --- Node status snapshot for DecisionPoint ---

function buildNodesSummary(workflow: WorkflowRecord): DecisionPoint["nodes"] {
  return Object.entries(workflow.nodes).map(([id, node]) => ({
    node_id: id, role: node.role, status: workflow.node_statuses[id] ?? "blocked",
    depends_on: node.depends_on, assignment_id: node.assignment_id,
  }));
}

// ============================================================
// Public API
// ============================================================

// --- initWorkflow ---

export interface InitWorkflowOptions {
  intent: string;
  repoPath: string;
  worktreePath?: string;
  defaultAgentType?: AgentType;
  defaultTimeoutMinutes?: number;
  defaultMaxRetries?: number;
  autoApprove?: boolean;
}

export interface InitWorkflowResult {
  workflow_id: string;
  worktree_path: string;
  branch: string | null;
  base_branch: string;
}

export async function initWorkflow(
  options: InitWorkflowOptions, deps?: WorkflowDependencies,
): Promise<InitWorkflowResult> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workflowId = generateWorkflowId();

  // Lead identity comes from the calling terminal. Without it, the workflow
  // has no owner and lead-guard cannot enforce single-Lead semantics.
  const leadTerminalId = process.env.TERMCANVAS_TERMINAL_ID;
  if (!leadTerminalId) {
    throw new HydraError(
      "Cannot init workflow: TERMCANVAS_TERMINAL_ID is not set. The Lead must be a TermCanvas terminal.",
      { errorCode: "WORKFLOW_NO_LEAD", stage: "workflow.init" },
    );
  }

  const workspace = prepareWorkflowWorkspace(repoPath, workflowId, options.worktreePath, deps);
  const intentFile = writeWorkflowIntent(repoPath, workflowId, options.intent);

  const workflow: WorkflowRecord = {
    schema_version: WORKFLOW_STATE_SCHEMA_VERSION,
    id: workflowId,
    lead_terminal_id: leadTerminalId,
    intent_file: path.relative(repoPath, intentFile),
    repo_path: repoPath,
    worktree_path: workspace.worktreePath,
    branch: workspace.branch,
    base_branch: workspace.baseBranch,
    own_worktree: workspace.ownWorktree,
    created_at: now(), updated_at: now(),
    status: "active",
    nodes: {}, node_statuses: {},
    assignment_ids: [],
    default_timeout_minutes: options.defaultTimeoutMinutes ?? 30,
    default_max_retries: options.defaultMaxRetries ?? 1,
    default_agent_type: options.defaultAgentType ?? resolveDefaultAgentType(),
    auto_approve: options.autoApprove ?? true,
  };
  saveWorkflow(workflow);
  appendLedger(repoPath, workflowId, {
    type: "workflow_created",
    intent_file: workflow.intent_file,
    lead_terminal_id: leadTerminalId,
  });

  return {
    workflow_id: workflowId,
    worktree_path: workspace.worktreePath,
    branch: workspace.branch,
    base_branch: workspace.baseBranch,
  };
}

// --- dispatchNode ---

export interface DispatchNodeOptions {
  repoPath: string;
  workflowId: string;
  nodeId: string;
  role: string;
  intent: string;
  dependsOn?: string[];
  agentType?: AgentType;
  contextRefs?: Array<{ label: string; path: string }>;
  feedback?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  timeoutMinutes?: number;
  maxRetries?: number;
}

export interface DispatchNodeResult {
  node_id: string;
  assignment_id: string;
  status: "dispatched" | "blocked" | "failed";
  terminal_id?: string;
  failure?: WorkflowFailure;
}

export async function dispatchNode(
  options: DispatchNodeOptions, deps?: WorkflowDependencies,
): Promise<DispatchNodeResult> {
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  ensureLeadCaller(workflow);

  if (workflow.status !== "active") {
    throw new HydraError(`Workflow is not active: ${workflow.status}`, {
      errorCode: "WORKFLOW_NOT_ACTIVE", stage: "workflow.dispatch_node", ids: { workflow_id: workflow.id },
    });
  }
  if (workflow.nodes[options.nodeId]) {
    throw new HydraError(`Node already exists: ${options.nodeId}`, {
      errorCode: "WORKFLOW_NODE_EXISTS", stage: "workflow.dispatch_node", ids: { workflow_id: workflow.id },
    });
  }

  const dependsOn = options.dependsOn ?? [];
  for (const depId of dependsOn) {
    if (!workflow.nodes[depId]) {
      throw new HydraError(`Dependency node not found: ${depId}`, {
        errorCode: "WORKFLOW_DEP_NOT_FOUND", stage: "workflow.dispatch_node", ids: { workflow_id: workflow.id },
      });
    }
  }
  if (hasCycle(workflow, options.nodeId, dependsOn)) {
    throw new HydraError(`Adding node "${options.nodeId}" would create a cycle`, {
      errorCode: "WORKFLOW_CYCLE", stage: "workflow.dispatch_node", ids: { workflow_id: workflow.id },
    });
  }

  // Create node — write intent to nodes/{id}/intent.md
  const agentType = options.agentType ?? workflow.default_agent_type;
  const intentFileAbs = writeNodeIntent(repoPath, workflow.id, options.nodeId, options.role, options.intent);
  let feedbackFileRel: string | undefined;
  if (options.feedback) {
    const feedbackAbs = writeNodeFeedback(repoPath, workflow.id, options.nodeId, options.feedback);
    feedbackFileRel = path.relative(repoPath, feedbackAbs);
  }

  const node: WorkflowNode = {
    id: options.nodeId, role: options.role, depends_on: dependsOn, agent_type: agentType,
    intent_file: path.relative(repoPath, intentFileAbs),
    feedback_file: feedbackFileRel,
    context_refs: options.contextRefs,
    worktree_path: options.worktreePath, worktree_branch: options.worktreeBranch,
    timeout_minutes: options.timeoutMinutes ?? workflow.default_timeout_minutes,
    max_retries: options.maxRetries ?? workflow.default_max_retries,
  };

  // Create assignment
  const manager = managerForWorkflow(workflow);
  const assignmentId = generateAssignmentId();
  const fromAssignmentId = dependsOn.length > 0
    ? workflow.nodes[dependsOn[0]]?.assignment_id ?? null : null;
  manager.create({
    id: assignmentId, workflow_id: workflow.id,
    workspace_root: workflow.repo_path, worktree_path: node.worktree_path ?? workflow.worktree_path,
    role: options.role, from_assignment_id: fromAssignmentId,
    requested_agent_type: agentType,
    timeout_minutes: node.timeout_minutes ?? workflow.default_timeout_minutes,
    max_retries: node.max_retries ?? workflow.default_max_retries,
  });
  node.assignment_id = assignmentId;

  // Register node
  workflow.nodes[options.nodeId] = node;
  workflow.assignment_ids.push(assignmentId);

  const eligible = allDepsCompleted(workflow, node);
  workflow.node_statuses[options.nodeId] = eligible ? "eligible" : "blocked";

  appendLedger(repoPath, workflow.id, {
    type: "node_dispatched", node_id: options.nodeId, role: options.role,
    agent_type: agentType, intent_file: node.intent_file,
  });

  if (eligible) {
    const assignment = loadAssignmentByIdOrThrow(manager, workflow, assignmentId);
    const runId = generateRunId();
    const result = await dispatchAssignment(workflow, assignment, node, runId, deps);
    if (result.status === "dispatched") {
      workflow.node_statuses[options.nodeId] = "dispatched";
      saveWorkflow(workflow);
      return { node_id: options.nodeId, assignment_id: assignmentId, status: "dispatched", terminal_id: result.terminalId };
    }
    workflow.node_statuses[options.nodeId] = "failed";
    workflow.failure = result.failure;
    saveWorkflow(workflow);
    return { node_id: options.nodeId, assignment_id: assignmentId, status: "failed", failure: result.failure };
  }

  saveWorkflow(workflow);
  return { node_id: options.nodeId, assignment_id: assignmentId, status: "blocked" };
}

// --- redispatchNode ---

export interface RedispatchNodeOptions {
  repoPath: string;
  workflowId: string;
  nodeId: string;
  intent?: string;
}

export async function redispatchNode(
  options: RedispatchNodeOptions, deps?: WorkflowDependencies,
): Promise<DispatchNodeResult> {
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  ensureLeadCaller(workflow);
  const node = workflow.nodes[options.nodeId];

  if (!node) {
    throw new HydraError(`Node not found: ${options.nodeId}`, {
      errorCode: "WORKFLOW_NODE_NOT_FOUND", stage: "workflow.redispatch_node", ids: { workflow_id: workflow.id },
    });
  }

  const currentStatus = workflow.node_statuses[options.nodeId];
  if (currentStatus !== "eligible" && currentStatus !== "reset") {
    throw new HydraError(`Node "${options.nodeId}" is not eligible for redispatch (status: ${currentStatus})`, {
      errorCode: "WORKFLOW_NODE_NOT_ELIGIBLE", stage: "workflow.redispatch_node", ids: { workflow_id: workflow.id },
    });
  }

  if (!node.assignment_id) {
    throw new HydraError(`Node "${options.nodeId}" has no assignment`, {
      errorCode: "WORKFLOW_NODE_NO_ASSIGNMENT", stage: "workflow.redispatch_node", ids: { workflow_id: workflow.id },
    });
  }

  // Update intent if provided — overwrite the intent file
  if (options.intent) {
    const intentAbs = writeNodeIntent(repoPath, workflow.id, options.nodeId, node.role, options.intent);
    node.intent_file = path.relative(repoPath, intentAbs);
  }

  const manager = managerForWorkflow(workflow);
  const assignment = loadAssignmentByIdOrThrow(manager, workflow, node.assignment_id);
  const runId = generateRunId();

  appendLedger(repoPath, workflow.id, {
    type: "node_dispatched", node_id: options.nodeId, role: node.role,
    agent_type: node.agent_type, intent_file: node.intent_file,
  });

  const result = await dispatchAssignment(workflow, assignment, node, runId, deps);
  if (result.status === "dispatched") {
    workflow.node_statuses[options.nodeId] = "dispatched";
    saveWorkflow(workflow);
    return { node_id: options.nodeId, assignment_id: node.assignment_id, status: "dispatched", terminal_id: result.terminalId };
  }

  workflow.node_statuses[options.nodeId] = "failed";
  workflow.failure = result.failure;
  saveWorkflow(workflow);
  return { node_id: options.nodeId, assignment_id: node.assignment_id, status: "failed", failure: result.failure };
}

// --- watchUntilDecision ---

export interface WatchOptions {
  repoPath: string;
  workflowId: string;
  intervalMs?: number;
  timeoutMs?: number;
}

export async function watchUntilDecision(
  options: WatchOptions, deps?: WorkflowDependencies,
): Promise<DecisionPoint> {
  const now = nowFn(deps);
  const sleep = sleepFn(deps);
  const intervalMs = options.intervalMs ?? 5000;
  const startedAt = Date.parse(now());
  const repoPath = path.resolve(options.repoPath);

  // Guard once outside the loop — Lead identity doesn't change mid-watch
  ensureLeadCaller(loadWorkflowOrThrow(repoPath, options.workflowId));

  while (true) {
    const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
    if (workflow.status !== "active") {
      return { type: "batch_completed", workflow_id: workflow.id, timestamp: now(), nodes: buildNodesSummary(workflow) };
    }

    const manager = managerForWorkflow(workflow);
    const stateMachine = new AssignmentStateMachine(manager, { now });
    let changed = false;

    // Phase 1: Check dispatched nodes for results
    for (const [nodeId, nodeStatus] of Object.entries(workflow.node_statuses)) {
      if (nodeStatus !== "dispatched") continue;
      const node = workflow.nodes[nodeId];
      if (!node?.assignment_id) continue;
      const assignment = manager.load(node.assignment_id);
      if (!assignment) continue;

      // Handle pending assignments that were promoted to eligible but not yet dispatched by Lead
      if (assignment.status === "pending") {
        const runId = generateRunId();
        const result = await dispatchAssignment(workflow, assignment, node, runId, deps);
        if (result.status === "dispatched") { changed = true; }
        else { workflow.node_statuses[nodeId] = "failed"; }
        saveWorkflow(workflow);
        continue;
      }

      if (assignment.status !== "claimed" && assignment.status !== "in_progress") {
        // Sync node status from completed/failed assignments
        if (assignment.status === "completed") { workflow.node_statuses[nodeId] = "completed"; changed = true; }
        if (assignment.status === "failed" || assignment.status === "timed_out") { workflow.node_statuses[nodeId] = "failed"; changed = true; }
        saveWorkflow(workflow);
        continue;
      }

      const run = latestRun(assignment);
      if (!run) continue;

      const collected = collectRunResult({
        workflow_id: workflow.id, assignment_id: assignment.id,
        run_id: run.id, result_file: run.result_file,
      });

      if (collected.status === "completed") {
        // Route by outcome: error → Hydra retries automatically, completed/stuck → report to Lead
        if (collected.result.outcome === "error") {
          await stateMachine.markTimedOut(assignment.id, {
            code: "AGENT_REPORTED_ERROR",
            message: `Agent reported error in ${collected.result.report_file}`,
            stage: "workflow.agent_error",
          });
          const retryResult = await stateMachine.scheduleRetry(assignment.id);
          if (retryResult.assignment.status === "failed") {
            workflow.node_statuses[nodeId] = "failed";
            const durationMs = run.started_at ? Date.parse(now()) - Date.parse(run.started_at) : 0;
            appendLedger(repoPath, workflow.id, {
              type: "node_failed", node_id: nodeId, role: node.role, agent_type: node.agent_type,
              duration_ms: durationMs, retries_used: assignment.retry_count + 1,
              failure_code: "AGENT_REPORTED_ERROR",
            });
            saveWorkflow(workflow);
            return {
              type: "node_failed_final", workflow_id: workflow.id, timestamp: now(),
              failed: {
                node_id: nodeId, role: node.role, code: "AGENT_REPORTED_ERROR",
                message: `Agent reported error in ${collected.result.report_file}`,
                retries_used: assignment.retry_count + 1, max_retries: assignment.max_retries,
              },
              nodes: buildNodesSummary(workflow),
            };
          }
          // Retry scheduled — re-dispatch
          await destroyAssignmentTerminal(assignment, deps);
          const retryRunId = generateRunId();
          const freshAssignment = loadAssignmentByIdOrThrow(manager, workflow, assignment.id);
          await dispatchAssignment(workflow, freshAssignment, node, retryRunId, deps);
          saveWorkflow(workflow);
          continue;
        }

        // outcome is "completed" or "stuck" — report to Lead
        const mappedResult = {
          outcome: collected.result.outcome,
          report_file: collected.result.report_file,
          completed_at: now(),
        };
        await stateMachine.markCompleted(assignment.id, mappedResult);
        await destroyAssignmentTerminal(assignment, deps);
        workflow.node_statuses[nodeId] = "completed";

        // Reload assignment to get the captured session_id (set by destroyAssignmentTerminal)
        const reloadedAssignment = manager.load(assignment.id);
        const reloadedRun = reloadedAssignment?.runs.find((r) => r.id === run.id);
        const sessionId = reloadedRun?.session_id;

        const durationMs = run.started_at ? Date.parse(now()) - Date.parse(run.started_at) : 0;
        appendLedger(repoPath, workflow.id, {
          type: "node_completed", node_id: nodeId, role: node.role, agent_type: node.agent_type,
          duration_ms: durationMs, retries_used: assignment.retry_count,
          outcome: collected.result.outcome,
          report_file: collected.result.report_file,
          session_id: sessionId,
        });

        // Promote blocked → eligible (Lead decides whether to dispatch)
        const promoted = promoteEligibleNodes(workflow);

        saveWorkflow(workflow);
        return {
          type: "node_completed", workflow_id: workflow.id, timestamp: now(),
          completed: {
            node_id: nodeId, role: node.role,
            outcome: collected.result.outcome,
            report_file: collected.result.report_file,
            duration_ms: durationMs,
            retries_used: assignment.retry_count,
            session: sessionId && reloadedRun?.session_provider
              ? { provider: reloadedRun.session_provider, id: sessionId, file: reloadedRun.session_file }
              : undefined,
          },
          nodes: buildNodesSummary(workflow),
          newly_eligible: promoted.length > 0 ? promoted : undefined,
        };
      }

      if (collected.status === "failed") {
        await stateMachine.markFailed(assignment.id, collected.failure);
        workflow.node_statuses[nodeId] = "failed";
        const durationMs = run.started_at ? Date.parse(now()) - Date.parse(run.started_at) : 0;
        appendLedger(repoPath, workflow.id, {
          type: "node_failed", node_id: nodeId, role: node.role, agent_type: node.agent_type,
          duration_ms: durationMs, retries_used: assignment.retry_count,
          failure_code: collected.failure.code,
        });
        saveWorkflow(workflow);
        return {
          type: "node_failed", workflow_id: workflow.id, timestamp: now(),
          failed: {
            node_id: nodeId, role: node.role, code: collected.failure.code,
            message: collected.failure.message,
            retries_used: assignment.retry_count, max_retries: assignment.max_retries,
          },
          nodes: buildNodesSummary(workflow),
        };
      }

      // Still waiting — check terminal health
      const alive = checkTerminalAliveFn(deps)(run.terminal_id);
      if (alive === false) {
        const elapsedMs = run.started_at ? Date.parse(now()) - Date.parse(run.started_at) : 0;
        if (elapsedMs > SPAWN_GRACE_PERIOD_MS) {
          await destroyAssignmentTerminal(assignment, deps);
          await stateMachine.markTimedOut(assignment.id, {
            code: "ASSIGNMENT_PROCESS_EXITED",
            message: `Agent process exited without writing result (${Math.round(elapsedMs / 1000)}s)`,
            stage: "workflow.health_check",
          });
          const retryResult = await stateMachine.scheduleRetry(assignment.id);
          if (retryResult.assignment.status === "failed") {
            workflow.node_statuses[nodeId] = "failed";
            appendLedger(repoPath, workflow.id, {
              type: "node_failed", node_id: nodeId, role: node.role, agent_type: node.agent_type,
              duration_ms: elapsedMs, retries_used: assignment.retry_count + 1,
              failure_code: "ASSIGNMENT_PROCESS_EXITED",
            });
            saveWorkflow(workflow);
            return {
              type: "node_failed_final", workflow_id: workflow.id, timestamp: now(),
              failed: {
                node_id: nodeId, role: node.role, code: "ASSIGNMENT_PROCESS_EXITED",
                message: "Agent process exited and retry limit reached",
                retries_used: assignment.retry_count + 1, max_retries: assignment.max_retries,
              },
              nodes: buildNodesSummary(workflow),
            };
          }
          // Retry: re-dispatch
          const retryRunId = generateRunId();
          const freshAssignment = loadAssignmentByIdOrThrow(manager, workflow, assignment.id);
          const retryOutcome = await dispatchAssignment(workflow, freshAssignment, node, retryRunId, deps);
          if (retryOutcome.status === "dispatched") { changed = true; }
          saveWorkflow(workflow);
          continue;
        }
      }

      // Check duration timeout
      const freshAssignment = loadAssignmentByIdOrThrow(manager, workflow, assignment.id);
      if (hasAssignmentTimedOut(freshAssignment, now())) {
        const retryRunId = generateRunId();
        const retrySpec = buildTaskSpecFromIntent({ workflow, node, assignment: freshAssignment, runId: retryRunId });
        const retryArtifacts = writeRunTask(retrySpec);
        const retryOutcome = await retryTimedOutAssignment(
          {
            assignmentId: assignment.id, timeoutCheckedAt: now(),
            dispatchRequest: { ...buildDispatchRequest(workflow, freshAssignment, node, retryRunId), taskFile: retryArtifacts.task_file, resultFile: retryArtifacts.result_file },
            runId: retryRunId, taskFile: retryArtifacts.task_file, resultFile: retryArtifacts.result_file,
            artifactDir: retryArtifacts.artifact_dir,
          },
          { manager, stateMachine, dispatchCreateOnly: dispatchFn(deps), destroyTerminal: destroyTerminalFn(deps), now },
        );
        if (retryOutcome.status === "failed") {
          workflow.node_statuses[nodeId] = "failed";
          appendLedger(repoPath, workflow.id, {
            type: "node_failed", node_id: nodeId, role: node.role, agent_type: node.agent_type,
            duration_ms: 0, retries_used: freshAssignment.retry_count + 1,
            failure_code: "ASSIGNMENT_TIMED_OUT",
          });
          saveWorkflow(workflow);
          return {
            type: "node_failed_final", workflow_id: workflow.id, timestamp: now(),
            failed: {
              node_id: nodeId, role: node.role, code: "ASSIGNMENT_TIMED_OUT",
              message: "Assignment timed out and retry limit reached",
              retries_used: freshAssignment.retry_count + 1, max_retries: freshAssignment.max_retries,
            },
            nodes: buildNodesSummary(workflow),
          };
        }
        changed = true;
        saveWorkflow(workflow);
      }
    }

    // Phase 2: Check if no dispatched nodes remain (Lead needs to decide next)
    const statuses = Object.values(workflow.node_statuses);
    const anyDispatched = statuses.includes("dispatched");
    if (!anyDispatched && statuses.length > 0 && !changed) {
      saveWorkflow(workflow);
      return { type: "batch_completed", workflow_id: workflow.id, timestamp: now(), nodes: buildNodesSummary(workflow) };
    }

    // Phase 3: Timeout check
    if (options.timeoutMs !== undefined) {
      const elapsed = Date.parse(now()) - startedAt;
      if (elapsed >= options.timeoutMs) {
        return { type: "watch_timeout", workflow_id: workflow.id, timestamp: now(), nodes: buildNodesSummary(workflow) };
      }
    }

    if (!changed) await sleep(intervalMs);
  }
}

// --- resetNode ---

export interface ResetNodeOptions {
  repoPath: string;
  workflowId: string;
  nodeId: string;
  feedback?: string;
  cascade?: boolean;
}

export interface ResetNodeResult {
  reset_node_ids: string[];
  re_eligible_node_ids: string[];
}

export async function resetNode(
  options: ResetNodeOptions, deps?: WorkflowDependencies,
): Promise<ResetNodeResult> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  ensureLeadCaller(workflow);
  const manager = managerForWorkflow(workflow);

  if (!workflow.nodes[options.nodeId]) {
    throw new HydraError(`Node not found: ${options.nodeId}`, {
      errorCode: "WORKFLOW_NODE_NOT_FOUND", stage: "workflow.reset_node", ids: { workflow_id: workflow.id },
    });
  }

  const resetNodeIds = options.cascade !== false
    ? cascadeReset(workflow, options.nodeId)
    : (() => {
        const node = workflow.nodes[options.nodeId];
        workflow.node_statuses[options.nodeId] = node && allDepsCompleted(workflow, node) ? "eligible" : "blocked";
        return [options.nodeId];
      })();

  // Reset assignments and destroy terminals
  for (const id of resetNodeIds) {
    const node = workflow.nodes[id];
    if (!node?.assignment_id) continue;
    const assignment = manager.load(node.assignment_id);
    if (assignment) {
      await destroyAssignmentTerminal(assignment, deps);
      // Reset assignment to pending
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
    // node_statuses already set by cascadeReset (target=eligible, downstream=blocked)
  }

  // Store feedback on target node — write feedback.md, store path
  let feedbackFileRel: string | undefined;
  if (options.feedback) {
    const feedbackAbs = writeNodeFeedback(repoPath, workflow.id, options.nodeId, options.feedback);
    feedbackFileRel = path.relative(repoPath, feedbackAbs);
    workflow.nodes[options.nodeId].feedback_file = feedbackFileRel;
  } else {
    // Reset clears any prior feedback file
    clearNodeFeedback(repoPath, workflow.id, options.nodeId);
    workflow.nodes[options.nodeId].feedback_file = undefined;
  }

  // Find re-eligible nodes
  const reEligible = resetNodeIds.filter((id) => {
    const node = workflow.nodes[id];
    return node && allDepsCompleted(workflow, node);
  });

  appendLedger(repoPath, workflow.id, {
    type: "node_reset", node_id: options.nodeId, role: workflow.nodes[options.nodeId].role,
    feedback_file: feedbackFileRel, cascade_targets: resetNodeIds.filter((id) => id !== options.nodeId),
  });

  workflow.updated_at = now();
  saveWorkflow(workflow);
  return { reset_node_ids: resetNodeIds, re_eligible_node_ids: reEligible };
}

// --- mergeWorktrees ---

export interface MergeWorktreesOptions {
  repoPath: string;
  workflowId: string;
  sourceNodeIds: string[];
  targetBranch?: string;
}

export type MergeOutcome =
  | { status: "merged"; commit_sha: string }
  | { status: "conflict"; conflicting_files: string[] };

export async function mergeWorktrees(
  options: MergeWorktreesOptions, deps?: WorkflowDependencies,
): Promise<MergeOutcome> {
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  ensureLeadCaller(workflow);

  for (const nodeId of options.sourceNodeIds) {
    if (workflow.node_statuses[nodeId] !== "completed") {
      throw new HydraError(`Node "${nodeId}" is not completed`, {
        errorCode: "WORKFLOW_MERGE_NOT_READY", stage: "workflow.merge", ids: { workflow_id: workflow.id },
      });
    }
  }

  const targetBranch = options.targetBranch ?? workflow.branch ?? workflow.base_branch;
  const cwd = workflow.worktree_path;

  // Checkout target branch and record HEAD for rollback
  execFileSync("git", ["checkout", targetBranch], { cwd, encoding: "utf-8", stdio: "pipe" });
  const preMergeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", stdio: "pipe" }).trim();

  for (const nodeId of options.sourceNodeIds) {
    const node = workflow.nodes[nodeId];
    const branch = node?.worktree_branch;
    if (!branch) {
      throw new HydraError(`Node "${nodeId}" has no worktree_branch — cannot merge`, {
        errorCode: "WORKFLOW_MERGE_NO_BRANCH", stage: "workflow.merge", ids: { workflow_id: workflow.id },
      });
    }

    try {
      execFileSync("git", ["merge", "--no-ff", branch, "-m", `Merge ${nodeId} (${node.role})`], { cwd, encoding: "utf-8", stdio: "pipe" });
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
      appendLedger(repoPath, workflow.id, { type: "merge_attempted", source_nodes: options.sourceNodeIds, outcome: "conflict" });
      return { status: "conflict", conflicting_files: conflictingFiles };
    }
  }

  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
  appendLedger(repoPath, workflow.id, { type: "merge_attempted", source_nodes: options.sourceNodeIds, outcome: "merged" });
  return { status: "merged", commit_sha: commitSha };
}

// --- approveNode ---

export interface ApproveNodeOptions {
  repoPath: string;
  workflowId: string;
  nodeId: string;
}

export async function approveNode(options: ApproveNodeOptions, deps?: WorkflowDependencies): Promise<void> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  ensureLeadCaller(workflow);
  const manager = managerForWorkflow(workflow);
  const node = workflow.nodes[options.nodeId];
  if (!node?.assignment_id) {
    throw new HydraError(`Node "${options.nodeId}" has no assignment`, {
      errorCode: "WORKFLOW_APPROVE_NO_ASSIGNMENT", stage: "workflow.approve", ids: { workflow_id: workflow.id },
    });
  }
  const assignment = loadAssignmentByIdOrThrow(manager, workflow, node.assignment_id);
  const run = latestRun(assignment);
  if (!run) {
    throw new HydraError(`Node "${options.nodeId}" has no run`, {
      errorCode: "WORKFLOW_APPROVE_NO_RUN", stage: "workflow.approve", ids: { workflow_id: workflow.id },
    });
  }

  if (!workflow.approved_refs) workflow.approved_refs = {};
  workflow.approved_refs[options.nodeId] = {
    assignment_id: assignment.id, run_id: run.id,
    brief_file: getRunReportFile(repoPath, workflow.id, assignment.id, run.id),
    result_file: run.result_file, approved_at: now(),
  };

  appendLedger(repoPath, workflow.id, { type: "node_approved", node_id: options.nodeId, role: node.role });
  workflow.updated_at = now();
  saveWorkflow(workflow);
}

// --- completeWorkflow ---

export async function completeWorkflow(
  options: { repoPath: string; workflowId: string; summary?: string }, deps?: WorkflowDependencies,
): Promise<void> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  ensureLeadCaller(workflow);
  const manager = managerForWorkflow(workflow);

  // Destroy any running terminals (captures session_id before destroy)
  for (const assignmentId of workflow.assignment_ids) {
    const a = manager.load(assignmentId);
    if (a && (a.status === "claimed" || a.status === "in_progress")) {
      await destroyAssignmentTerminal(a, deps);
    }
  }

  const totalDuration = Date.parse(now()) - Date.parse(workflow.created_at);
  const totalRetries = workflow.assignment_ids.reduce((sum, id) => {
    const a = manager.load(id);
    return sum + (a?.retry_count ?? 0);
  }, 0);

  // Write summary file if Lead provided a summary
  let resultFileRel: string | undefined;
  if (options.summary) {
    const summaryAbs = writeWorkflowSummary(repoPath, workflow.id, options.summary);
    resultFileRel = path.relative(repoPath, summaryAbs);
    workflow.result_file = resultFileRel;
  }

  workflow.status = "completed";
  workflow.failure = undefined;
  workflow.updated_at = now();
  saveWorkflow(workflow);

  appendLedger(repoPath, workflow.id, {
    type: "workflow_completed",
    result_file: resultFileRel,
    total_duration_ms: totalDuration,
    total_nodes: Object.keys(workflow.nodes).length,
    total_retries: totalRetries,
  });
}

// --- failWorkflow ---

export async function failWorkflow(
  options: { repoPath: string; workflowId: string; reason: string }, deps?: WorkflowDependencies,
): Promise<void> {
  const now = nowFn(deps);
  const repoPath = path.resolve(options.repoPath);
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  ensureLeadCaller(workflow);
  const manager = managerForWorkflow(workflow);

  for (const assignmentId of workflow.assignment_ids) {
    const a = manager.load(assignmentId);
    if (a && (a.status === "claimed" || a.status === "in_progress")) {
      await destroyAssignmentTerminal(a, deps);
    }
  }

  const totalDuration = Date.parse(now()) - Date.parse(workflow.created_at);
  workflow.status = "failed";
  workflow.failure = { code: "WORKFLOW_MANUALLY_FAILED", message: options.reason, stage: "workflow.fail" };
  workflow.updated_at = now();
  saveWorkflow(workflow);

  appendLedger(repoPath, workflow.id, {
    type: "workflow_failed", reason: options.reason, total_duration_ms: totalDuration,
  });
}

// --- getWorkflowStatus ---

export interface WorkflowStatusView {
  workflow: WorkflowRecord;
  assignments: AssignmentRecord[];
}

export function getWorkflowStatus(repoPath: string, workflowId: string): WorkflowStatusView {
  const workflow = loadWorkflowOrThrow(path.resolve(repoPath), workflowId);
  const manager = managerForWorkflow(workflow);
  const assignments = workflow.assignment_ids
    .map((id) => manager.load(id))
    .filter((a): a is AssignmentRecord => a !== null);
  return { workflow, assignments };
}

// --- cleanupWorkflow ---

export function cleanupWorkflowState(repoPath: string, workflowId: string): void {
  deleteWorkflow(repoPath, workflowId);
}
