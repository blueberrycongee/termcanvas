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
import { validateHandoffContract, type ResultContract } from "./protocol.ts";
import { registerDispatchAttempt, retryTimedOutHandoff } from "./retry.ts";
import { buildTaskPackageContext, writeTaskPackage } from "./task-package.ts";
import {
  deleteWorkflow,
  loadWorkflow,
  saveWorkflow,
  type WorkflowFailure,
  type WorkflowRecord,
} from "./workflow-store.ts";
import { findProjectByPath, projectRescan } from "./termcanvas.ts";
import { buildGitWorktreeAddArgs, validateWorktreePath } from "./spawn.ts";

export interface RunWorkflowOptions {
  task: string;
  repoPath: string;
  worktreePath?: string;
  agentType: AgentType;
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

export interface WorkflowStatusView {
  workflow: WorkflowRecord;
  handoffs: Handoff[];
}

export interface WorkflowDependencies {
  now?: () => string;
  dispatchCreateOnly?: (request: DispatchCreateOnlyRequest) => Promise<DispatchCreateOnlyResult>;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function nowFn(dependencies: WorkflowDependencies | undefined): () => string {
  return dependencies?.now ?? (() => new Date().toISOString());
}

function dispatchFn(dependencies: WorkflowDependencies | undefined) {
  return dependencies?.dispatchCreateOnly ?? defaultDispatchCreateOnly;
}

function sleepFn(dependencies: WorkflowDependencies | undefined) {
  return dependencies?.sleep ?? DEFAULT_SLEEP;
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
): { worktreePath: string; branch: string | null; baseBranch: string; ownWorktree: boolean } {
  const repo = path.resolve(repoPath);
  const baseBranch = getCurrentBranch(repo);

  if (requestedWorktreePath) {
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
    resultFile: handoff.artifacts.result_file,
    autoApprove: workflow.auto_approve,
  };
}

function mapResultContract(result: ResultContract): NonNullable<Handoff["result"]> {
  return {
    success: result.success,
    summary: result.summary,
    outputs: result.outputs,
    evidence: result.evidence,
    next_action: result.next_action,
    message: result.summary,
    output_files: result.outputs.map((output) => output.path),
  };
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

  handoff.status = "pending";
  handoff.status_updated_at = now;
  handoff.claim = undefined;
  handoff.last_error = undefined;
  handoff.result = undefined;
  handoff.transitions = handoff.transitions ?? [];
  handoff.transitions.push({
    event: "manual_retry",
    from: handoff.status,
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
  const handoffId = generateHandoffId();
  const workspace = prepareWorkflowWorkspace(repoPath, workflowId, options.worktreePath);
  const manager = new HandoffManager(repoPath);

  const from = {
    role: "planner" as const,
    agent_type: "claude" as const,
    agent_id: "hydra-run",
  };
  const to = {
    role: "implementer" as const,
    agent_type: options.agentType,
    agent_id: null,
  };

  const taskPackage = buildTaskPackageContext({
    workspaceRoot: repoPath,
    workflowId,
    handoffId,
    createdAt: now(),
    from,
    to,
    task: {
      type: workspace.ownWorktree ? "code-change-task" : "read-only-task",
      title: options.task.slice(0, 80),
      description: options.task,
      acceptance_criteria: [
        "Write result.json and done",
        "Provide evidence for the outcome",
      ],
    },
    context: {
      files: [],
      previous_handoffs: [],
      shared_state: {
        worktree_path: workspace.worktreePath,
        branch: workspace.branch,
        base_branch: workspace.baseBranch,
      },
    },
  });
  writeTaskPackage(taskPackage.contract);

  const createdHandoff = manager.create({
    id: handoffId,
    workflow_id: workflowId,
    workspace_root: repoPath,
    worktree_path: workspace.worktreePath,
    from,
    to,
    task: taskPackage.contract.task,
    context: taskPackage.contract.context,
    artifacts: taskPackage.contract.artifacts,
    timeout_minutes: options.timeoutMinutes,
    max_retries: options.maxRetries,
  });

  const workflow: WorkflowRecord = {
    id: workflowId,
    template: "single-step",
    task: options.task,
    repo_path: repoPath,
    worktree_path: workspace.worktreePath,
    branch: workspace.branch,
    base_branch: workspace.baseBranch,
    own_worktree: workspace.ownWorktree,
    agent_type: options.agentType,
    created_at: now(),
    updated_at: now(),
    status: "pending",
    current_handoff_id: createdHandoff.id,
    handoff_ids: [createdHandoff.id],
    timeout_minutes: options.timeoutMinutes,
    max_retries: options.maxRetries,
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
  const manager = new HandoffManager(repoPath);
  const stateMachine = new HandoffStateMachine(manager, { now });
  const workflow = loadWorkflowOrThrow(repoPath, options.workflowId);
  const handoff = loadHandoffOrThrow(manager, workflow);

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
      workflow.updated_at = now();
      workflow.result = collected.result;
      if (collected.result.success) {
        workflow.status = "completed";
        workflow.failure = undefined;
      } else {
        workflow.status = "failed";
        workflow.failure = {
          code: "WORKFLOW_RESULT_UNSUCCESSFUL",
          message: collected.result.summary,
          stage: "workflow.collect",
        };
      }
      saveWorkflow(workflow);
      return buildStatusView(workflow);
    }

    if (collected.status === "failed") {
      await stateMachine.markFailed(handoff.id, collected.failure);
      saveWorkflowFailure(workflow, collected.failure, now());
      return buildStatusView(workflow);
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
    if (view.workflow.status === "completed" || view.workflow.status === "failed") {
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

export function cleanupWorkflowState(repoPath: string, workflowId: string): void {
  deleteWorkflow(repoPath, workflowId);
}
