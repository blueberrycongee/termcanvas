import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ProjectScanner } from "../electron/project-scanner.ts";
import type { PtyManager } from "../electron/pty-manager.ts";
import type { TelemetryService } from "../electron/telemetry-service.ts";
import { buildGitBranchDeleteArgs, buildGitWorktreeRemoveArgs } from "../hydra/src/cleanup.ts";
import {
  buildCreateOnlyPrompt,
  type DispatchCreateOnlyRequest,
  type DispatchCreateOnlyResult,
} from "../hydra/src/dispatcher.ts";
import { AssignmentManager } from "../hydra/src/assignment/manager.ts";
import type { AgentType } from "../hydra/src/assignment/types.ts";
import { listRoles as listRoleRegistry, type RoleDefinition } from "../hydra/src/roles/loader.ts";
import {
  initWorkbench as initWorkflow,
  dispatch as dispatchNode,
  redispatch as redispatchNode,
  watchUntilDecision,
  approveDispatch,
  resetDispatch as resetNode,
  mergeWorktrees,
  completeWorkbench as completeWorkflow,
  failWorkbench as failWorkflow,
  getWorkbenchStatus as getWorkflowStatus,
  askDispatch as askNode,
  type WorkbenchStatusView as WorkflowStatusView,
  type InitWorkbenchOptions as BaseInitWorkflowOptions,
  type InitWorkbenchResult as BaseInitWorkflowResult,
  type DispatchOptions as BaseDispatchNodeOptions,
  type DispatchResult as BaseDispatchNodeResult,
  type ResetDispatchResult as ResetNodeResult,
  type MergeOutcome,
  type AskDispatchOptions as BaseAskNodeOptions,
  type AskDispatchResult as AskNodeResult,
} from "../hydra/src/workflow-lead.ts";
import type { DecisionPoint as HydraDecisionPoint } from "../hydra/src/decision.ts";
import {
  deleteWorkbench as deleteWorkflow,
  listWorkbenches as listWorkflows,
  loadWorkbench as loadWorkflow,
  type WorkbenchRecord as WorkflowRecord,
} from "../hydra/src/workflow-store.ts";
import type { ServerEventBus } from "./event-bus.ts";
import { ensureProjectTracked } from "./project-sync.ts";
import {
  destroyTrackedTerminal,
  launchTrackedTerminal,
  type TerminalLaunchDeps,
} from "./terminal-launch.ts";
import {
  destroySubprocessWorker,
  launchSubprocessWorker,
} from "./subprocess-worker.ts";
import type { ProjectStore } from "./project-store.ts";

/**
 * Worker dispatch mode:
 *   - "pty":        legacy path — launch a termcanvas-tracked PTY terminal
 *                   with an interactive claude/codex session (default)
 *   - "subprocess": spawn a one-shot non-interactive CLI subprocess
 *                   (claude -p / codex exec --json). See subprocess-worker.ts
 *                   for rationale. Opt in via HYDRA_WORKER_MODE=subprocess or
 *                   by passing workerMode to createWorkflowControl.
 *
 * This flag exists to let us cut over one workflow at a time and retain the
 * PTY path as a rollback target while the subprocess path matures.
 */
export type WorkerMode = "pty" | "subprocess";

function resolveWorkerMode(explicit: WorkerMode | undefined): WorkerMode {
  if (explicit) return explicit;
  const fromEnv = process.env.HYDRA_WORKER_MODE;
  if (fromEnv === "subprocess") return "subprocess";
  return "pty";
}

export interface WorkflowSummary {
  id: string;
  status: WorkflowRecord["status"];
  intent_file: string;
  worktree_path: string;
  updated_at: string;
}

export interface RoleSummary {
  name: string;
  description: string;
  terminals: RoleDefinition["terminals"];
  source: RoleDefinition["source"];
}

export interface WorkflowControl {
  init(input: Omit<InitWorkflowOptions, "repoPath"> & { repoPath: string }): Promise<InitWorkflowResult>;
  dispatch(input: Omit<DispatchNodeOptions, "repoPath"> & { repoPath: string }): Promise<DispatchNodeResult>;
  redispatch(repoPath: string, workflowId: string, nodeId: string, intent?: string): Promise<DispatchNodeResult>;
  watchDecision(repoPath: string, workflowId: string): Promise<DecisionPoint>;
  resetNode(repoPath: string, workflowId: string, nodeId: string, feedback?: string): Promise<ResetNodeResult>;
  askNode(input: AskNodeOptions): Promise<AskNodeResult>;
  mergeNodes(repoPath: string, workflowId: string, nodeIds: string[]): Promise<MergeOutcome>;
  approveNode(repoPath: string, workflowId: string, nodeId: string): Promise<void>;
  complete(repoPath: string, workflowId: string, summary?: string): Promise<void>;
  fail(repoPath: string, workflowId: string, reason: string): Promise<void>;
  status(repoPath: string, workflowId: string): WorkflowStatusView;
  list(repoPath: string): WorkflowSummary[];
  listRoles(repoPath: string, agentTypeFilter?: string): RoleSummary[];
  cleanup(repoPath: string, workflowId: string, force?: boolean): { ok: true };
}

export interface DecisionPoint {
  type:
    | HydraDecisionPoint["type"]
    | "node_completed"
    | "node_failed"
    | "node_failed_final";
  workbench_id: string;
  timestamp: string;
  completed?: HydraDecisionPoint["completed"] & { node_id?: string };
  failed?: HydraDecisionPoint["failed"] & { node_id?: string };
  advisory?: HydraDecisionPoint["advisory"];
  dispatches: HydraDecisionPoint["dispatches"];
}

type InitWorkflowOptions = BaseInitWorkflowOptions & {
  defaultAgentType?: AgentType;
};

type InitWorkflowResult = BaseInitWorkflowResult & {
  workflow_id: string;
};

type DispatchNodeOptions = Omit<BaseDispatchNodeOptions, "repoPath" | "workbenchId" | "dispatchId"> & {
  repoPath: string;
  workflowId: string;
  nodeId: string;
  dependsOn?: string[];
};

type DispatchNodeResult = BaseDispatchNodeResult & {
  assignment_id: string;
  node_id: string;
};

type AskNodeOptions = Omit<BaseAskNodeOptions, "repoPath" | "workbenchId" | "dispatchId"> & {
  repoPath: string;
  workflowId: string;
  nodeId: string;
};

type WorkflowStatusViewCompat = WorkflowStatusView & {
  workflow: WorkflowStatusView["workbench"];
};

type ResetNodeResultCompat = ResetNodeResult & {
  reset_node_ids: string[];
};

interface WorkflowControlDeps extends TerminalLaunchDeps {
  projectScanner: ProjectScanner;
  /**
   * Opt into the subprocess worker dispatch path. Defaults to the value of
   * HYDRA_WORKER_MODE env var (or "pty" if unset). Preserved on the
   * WorkflowControl instance for the lifetime of the process — flipping it
   * per-dispatch is not supported in v1.
   */
  workerMode?: WorkerMode;
}

function isLiveStatus(status: string): boolean {
  return status === "running" || status === "active" || status === "waiting" || status === "idle";
}

function buildWorkflowSummary(record: WorkflowRecord): WorkflowSummary {
  return {
    id: record.id,
    status: record.status,
    intent_file: record.intent_file,
    worktree_path: record.worktree_path,
    updated_at: record.updated_at,
  };
}

function mapDecisionPoint(decision: HydraDecisionPoint): DecisionPoint {
  if (decision.type === "dispatch_completed") {
    return {
      ...decision,
      type: "node_completed",
      completed: decision.completed
        ? { ...decision.completed, node_id: decision.completed.dispatch_id }
        : undefined,
    };
  }

  if (decision.type === "dispatch_failed") {
    return {
      ...decision,
      type: "node_failed",
      failed: decision.failed
        ? { ...decision.failed, node_id: decision.failed.dispatch_id }
        : undefined,
    };
  }

  if (decision.type === "dispatch_failed_final") {
    return {
      ...decision,
      type: "node_failed_final",
      failed: decision.failed
        ? { ...decision.failed, node_id: decision.failed.dispatch_id }
        : undefined,
    };
  }

  return decision;
}

export function createWorkflowControl(
  input: WorkflowControlDeps,
): WorkflowControl {
  const workerMode = resolveWorkerMode(input.workerMode);

  const syncProject = (repoPath: string): void => {
    ensureProjectTracked({
      projectStore: input.projectStore,
      projectScanner: input.projectScanner,
      repoPath,
      onMutation: input.onMutation,
    });
  };

  const destroyTerminal = (terminalId: string): void => {
    // Subprocess termination is idempotent — returns false for PTY-backed
    // terminals, so this is safe to call unconditionally before the PTY
    // destroy path. The order matters: kill the child process first so we
    // don't race with its exit handler updating a removed terminal record.
    destroySubprocessWorker(terminalId);
    try {
      destroyTrackedTerminal({
        projectStore: input.projectStore,
        ptyManager: input.ptyManager,
        telemetryService: input.telemetryService,
        eventBus: input.eventBus,
        onMutation: input.onMutation,
        terminalId,
      });
    } catch {}
  };

  const dispatchCreateOnly = async (
    request: DispatchCreateOnlyRequest,
  ): Promise<DispatchCreateOnlyResult> => {
    syncProject(request.repoPath);
    const found = input.projectStore.findWorktree(request.worktreePath);
    if (!found) {
      throw Object.assign(new Error("Worktree not found on canvas"), { status: 404 });
    }

    const prompt = buildCreateOnlyPrompt(
      request.taskFile, request.workflowId, request.resultFile,
      { assignmentId: request.assignmentId, runId: request.runId },
    );

    if (workerMode === "subprocess") {
      const sub = await launchSubprocessWorker({
        projectStore: input.projectStore,
        telemetryService: input.telemetryService,
        eventBus: input.eventBus,
        onMutation: input.onMutation,
        worktree: request.worktreePath,
        type: request.agentType as AgentType,
        prompt,
        autoApprove: request.autoApprove,
        parentTerminalId: request.parentTerminalId,
        workflowId: request.workflowId,
        assignmentId: request.assignmentId,
        repoPath: request.repoPath,
        resumeSessionId: request.resumeSessionId,
        model: request.model,
        reasoningEffort: request.reasoningEffort,
      });
      return {
        projectId: found.projectId,
        terminalId: sub.id,
        terminalType: sub.type,
        terminalTitle: sub.title,
        prompt,
      };
    }

    const terminal = await launchTrackedTerminal({
      projectStore: input.projectStore,
      ptyManager: input.ptyManager,
      telemetryService: input.telemetryService,
      eventBus: input.eventBus,
      onMutation: input.onMutation,
      worktree: request.worktreePath,
      type: request.agentType as AgentType,
      prompt,
      autoApprove: request.autoApprove,
      parentTerminalId: request.parentTerminalId,
      workflowId: request.workflowId,
      assignmentId: request.assignmentId,
      repoPath: request.repoPath,
      resumeSessionId: request.resumeSessionId,
      model: request.model,
      reasoningEffort: request.reasoningEffort,
    });

    return {
      projectId: found.projectId,
      terminalId: terminal.id,
      terminalType: terminal.type,
      terminalTitle: terminal.title,
      prompt,
    };
  };

  const workflowDependencies = {
    dispatchCreateOnly,
    syncProject,
    destroyTerminal,
    checkTerminalAlive: (terminalId: string) => {
      const terminal = input.projectStore.getTerminal(terminalId);
      if (!terminal) return false;
      return isLiveStatus(terminal.status);
    },
  };

  return {
    async init(request) {
      const result = await initWorkflow(
        { ...request, repoPath: path.resolve(request.repoPath) },
        workflowDependencies,
      );
      return {
        ...result,
        workflow_id: result.workbench_id,
      };
    },
    async dispatch(request) {
      const result = await dispatchNode(
        {
          repoPath: path.resolve(request.repoPath),
          workbenchId: request.workflowId,
          dispatchId: request.nodeId,
          role: request.role,
          intent: request.intent,
          model: request.model,
          contextRefs: request.contextRefs,
          feedback: request.feedback,
          worktreePath: request.worktreePath,
          worktreeBranch: request.worktreeBranch,
          timeoutMinutes: request.timeoutMinutes,
          maxRetries: request.maxRetries,
          retryPolicy: request.retryPolicy,
          assessment: request.assessment,
        },
        workflowDependencies,
      );
      return {
        ...result,
        assignment_id: request.nodeId,
        node_id: request.nodeId,
      };
    },
    async redispatch(repoPath, workflowId, nodeId, intent) {
      return redispatchNode(
        { repoPath: path.resolve(repoPath), workbenchId: workflowId, dispatchId: nodeId, intent },
        workflowDependencies,
      );
    },
    async watchDecision(repoPath, workflowId) {
      const decision = await watchUntilDecision(
        { repoPath: path.resolve(repoPath), workbenchId: workflowId },
        workflowDependencies,
      );
      return mapDecisionPoint(decision);
    },
    async resetNode(repoPath, workflowId, nodeId, feedback) {
      const result = await resetNode(
        { repoPath: path.resolve(repoPath), workbenchId: workflowId, dispatchId: nodeId, feedback: feedback ?? "" },
        workflowDependencies,
      );
      return {
        ...result,
        reset_node_ids: [nodeId],
      } satisfies ResetNodeResultCompat;
    },
    async askNode(input) {
      return askNode(
        {
          ...input,
          repoPath: path.resolve(input.repoPath),
          workbenchId: input.workflowId,
          dispatchId: input.nodeId,
        },
        workflowDependencies,
      );
    },
    async mergeNodes(repoPath, workflowId, nodeIds) {
      return mergeWorktrees(
        { repoPath: path.resolve(repoPath), workbenchId: workflowId, sourceDispatchIds: nodeIds },
        workflowDependencies,
      );
    },
    async approveNode(repoPath, workflowId, nodeId) {
      return approveDispatch(
        { repoPath: path.resolve(repoPath), workbenchId: workflowId, dispatchId: nodeId },
        workflowDependencies,
      );
    },
    async complete(repoPath, workflowId, summary) {
      return completeWorkflow(
        { repoPath: path.resolve(repoPath), workbenchId: workflowId, summary },
        workflowDependencies,
      );
    },
    async fail(repoPath, workflowId, reason) {
      return failWorkflow(
        { repoPath: path.resolve(repoPath), workbenchId: workflowId, reason },
        workflowDependencies,
      );
    },
    status(repoPath, workflowId) {
      const status = getWorkflowStatus(path.resolve(repoPath), workflowId);
      return {
        ...status,
        workflow: status.workbench,
      } satisfies WorkflowStatusViewCompat;
    },
    list(repoPath) {
      return listWorkflows(path.resolve(repoPath))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .map(buildWorkflowSummary);
    },
    listRoles(repoPath, cliFilter) {
      const roles = listRoleRegistry(path.resolve(repoPath));
      // Filter on the primary terminal's CLI (terminals[0].cli) so the
      // HTTP-side filter matches the cliListRoles CLI behavior.
      const filtered = cliFilter
        ? roles.filter((role) => role.terminals[0]?.cli === cliFilter)
        : roles;
      return filtered.map((role) => ({
        name: role.name,
        description: role.description,
        terminals: role.terminals,
        source: role.source,
      }));
    },
    cleanup(repoPath, workflowId, force = false) {
      const resolvedRepo = path.resolve(repoPath);
      const workflow = loadWorkflow(resolvedRepo, workflowId);
      if (!workflow) {
        throw Object.assign(new Error(`Workflow not found: ${workflowId}`), { status: 404 });
      }

      const manager = new AssignmentManager(resolvedRepo, workflowId);
      for (const assignmentId of Object.keys(workflow.dispatches)) {
        const assignment = manager.load(assignmentId);
        const activeRun = assignment?.active_run_id
          ? assignment.runs.find((run) => run.id === assignment.active_run_id)
          : assignment?.runs[assignment.runs.length - 1];
        const terminalId = activeRun?.terminal_id;
        if (!terminalId) continue;

        const terminal = input.projectStore.getTerminal(terminalId);
        if (!force && terminal && isLiveStatus(terminal.status)) {
          throw Object.assign(
            new Error(`Workflow ${workflowId} has a running terminal (${terminalId}).`),
            { status: 409 },
          );
        }
        destroyTerminal(terminalId);
      }

      if (workflow.own_worktree) {
        try {
          execFileSync("git", buildGitWorktreeRemoveArgs(workflow.worktree_path), {
            cwd: workflow.repo_path, stdio: "pipe",
          });
        } catch {}
        if (workflow.branch) {
          try {
            execFileSync("git", buildGitBranchDeleteArgs(workflow.branch), {
              cwd: workflow.repo_path, stdio: "pipe",
            });
          } catch {}
        }
        syncProject(workflow.repo_path);
      }

      deleteWorkflow(resolvedRepo, workflowId);
      return { ok: true };
    },
  };
}
