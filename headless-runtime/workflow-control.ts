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
  initWorkflow,
  dispatchNode,
  redispatchNode,
  watchUntilDecision,
  approveNode,
  resetNode,
  mergeWorktrees,
  completeWorkflow,
  failWorkflow,
  getWorkflowStatus,
  type WorkflowStatusView,
  type InitWorkflowOptions,
  type InitWorkflowResult,
  type DispatchNodeOptions,
  type DispatchNodeResult,
  type ResetNodeResult,
  type MergeOutcome,
  type WatchOptions,
} from "../hydra/src/workflow-lead.ts";
import type { DecisionPoint } from "../hydra/src/decision.ts";
import {
  deleteWorkflow,
  listWorkflows,
  loadWorkflow,
  type WorkflowRecord,
} from "../hydra/src/workflow-store.ts";
import type { ServerEventBus } from "./event-bus.ts";
import { ensureProjectTracked } from "./project-sync.ts";
import {
  destroyTrackedTerminal,
  launchTrackedTerminal,
  type TerminalLaunchDeps,
} from "./terminal-launch.ts";
import type { ProjectStore } from "./project-store.ts";

export interface WorkflowSummary {
  id: string;
  status: WorkflowRecord["status"];
  intent_file: string;
  worktree_path: string;
  updated_at: string;
}

export interface RoleSummary {
  name: string;
  agent_type: RoleDefinition["agent_type"];
  description: string;
  model?: string;
  source: RoleDefinition["source"];
}

export interface WorkflowControl {
  init(input: Omit<InitWorkflowOptions, "repoPath"> & { repoPath: string }): Promise<InitWorkflowResult>;
  dispatch(input: Omit<DispatchNodeOptions, "repoPath"> & { repoPath: string }): Promise<DispatchNodeResult>;
  redispatch(repoPath: string, workflowId: string, nodeId: string, intent?: string): Promise<DispatchNodeResult>;
  watchDecision(repoPath: string, workflowId: string): Promise<DecisionPoint>;
  resetNode(repoPath: string, workflowId: string, nodeId: string, feedback?: string): Promise<ResetNodeResult>;
  mergeNodes(repoPath: string, workflowId: string, nodeIds: string[]): Promise<MergeOutcome>;
  approveNode(repoPath: string, workflowId: string, nodeId: string): Promise<void>;
  complete(repoPath: string, workflowId: string, summary?: string): Promise<void>;
  fail(repoPath: string, workflowId: string, reason: string): Promise<void>;
  status(repoPath: string, workflowId: string): WorkflowStatusView;
  list(repoPath: string): WorkflowSummary[];
  listRoles(repoPath: string, agentTypeFilter?: string): RoleSummary[];
  cleanup(repoPath: string, workflowId: string, force?: boolean): { ok: true };
}

interface WorkflowControlDeps extends TerminalLaunchDeps {
  projectScanner: ProjectScanner;
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

export function createWorkflowControl(
  input: WorkflowControlDeps,
): WorkflowControl {
  const syncProject = (repoPath: string): void => {
    ensureProjectTracked({
      projectStore: input.projectStore,
      projectScanner: input.projectScanner,
      repoPath,
      onMutation: input.onMutation,
    });
  };

  const destroyTerminal = (terminalId: string): void => {
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
      return initWorkflow(request, workflowDependencies);
    },
    async dispatch(request) {
      return dispatchNode(request, workflowDependencies);
    },
    async redispatch(repoPath, workflowId, nodeId, intent) {
      return redispatchNode(
        { repoPath: path.resolve(repoPath), workflowId, nodeId, intent },
        workflowDependencies,
      );
    },
    async watchDecision(repoPath, workflowId) {
      return watchUntilDecision(
        { repoPath: path.resolve(repoPath), workflowId },
        workflowDependencies,
      );
    },
    async resetNode(repoPath, workflowId, nodeId, feedback) {
      return resetNode(
        { repoPath: path.resolve(repoPath), workflowId, nodeId, feedback },
        workflowDependencies,
      );
    },
    async mergeNodes(repoPath, workflowId, nodeIds) {
      return mergeWorktrees(
        { repoPath: path.resolve(repoPath), workflowId, sourceNodeIds: nodeIds },
        workflowDependencies,
      );
    },
    async approveNode(repoPath, workflowId, nodeId) {
      return approveNode(
        { repoPath: path.resolve(repoPath), workflowId, nodeId },
        workflowDependencies,
      );
    },
    async complete(repoPath, workflowId, summary) {
      return completeWorkflow(
        { repoPath: path.resolve(repoPath), workflowId, summary },
        workflowDependencies,
      );
    },
    async fail(repoPath, workflowId, reason) {
      return failWorkflow(
        { repoPath: path.resolve(repoPath), workflowId, reason },
        workflowDependencies,
      );
    },
    status(repoPath, workflowId) {
      return getWorkflowStatus(path.resolve(repoPath), workflowId);
    },
    list(repoPath) {
      return listWorkflows(path.resolve(repoPath))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .map(buildWorkflowSummary);
    },
    listRoles(repoPath, agentTypeFilter) {
      const roles = listRoleRegistry(path.resolve(repoPath));
      const filtered = agentTypeFilter
        ? roles.filter((role) => role.agent_type === agentTypeFilter)
        : roles;
      return filtered.map((role) => ({
        name: role.name,
        agent_type: role.agent_type,
        description: role.description,
        model: role.model,
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
      for (const assignmentId of workflow.assignment_ids) {
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
