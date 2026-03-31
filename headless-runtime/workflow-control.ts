import { execFileSync } from "node:child_process";
import fs from "node:fs";
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
import { HandoffManager } from "../hydra/src/handoff/manager.ts";
import type { AgentType } from "../hydra/src/handoff/types.ts";
import {
  getWorkflowStatus,
  retryWorkflow,
  runWorkflow,
  tickWorkflow,
  type WorkflowStatusView,
} from "../hydra/src/workflow.ts";
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

export interface WorkflowRunRequest {
  task: string;
  repoPath: string;
  worktreePath?: string;
  template?: "single-step" | "planner-implementer-evaluator";
  allType?: AgentType;
  plannerType?: AgentType;
  implementerType?: AgentType;
  evaluatorType?: AgentType;
  timeoutMinutes?: number;
  maxRetries?: number;
  autoApprove?: boolean;
  approvePlan?: boolean;
}

export interface WorkflowSummary {
  id: string;
  status: WorkflowRecord["status"];
  task: string;
  worktree_path: string;
  current_handoff_id: string;
  updated_at: string;
}

export interface WorkflowControl {
  run(input: WorkflowRunRequest): Promise<WorkflowStatusView>;
  list(repoPath: string): WorkflowSummary[];
  status(repoPath: string, workflowId: string): WorkflowStatusView;
  tick(repoPath: string, workflowId: string): Promise<WorkflowStatusView>;
  retry(repoPath: string, workflowId: string): Promise<WorkflowStatusView>;
  cleanup(repoPath: string, workflowId: string, force?: boolean): { ok: true };
}

interface WorkflowControlDeps extends TerminalLaunchDeps {
  projectScanner: ProjectScanner;
}

function isLiveStatus(status: string): boolean {
  return (
    status === "running" ||
    status === "active" ||
    status === "waiting" ||
    status === "idle"
  );
}

function buildWorkflowSummary(record: WorkflowRecord): WorkflowSummary {
  return {
    id: record.id,
    status: record.status,
    task: record.task,
    worktree_path: record.worktree_path,
    current_handoff_id: record.current_handoff_id,
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
    } catch {
      // Terminal may already be gone.
    }
  };

  const dispatchCreateOnly = async (
    request: DispatchCreateOnlyRequest,
  ): Promise<DispatchCreateOnlyResult> => {
    syncProject(request.repoPath);
    const found = input.projectStore.findWorktree(request.worktreePath);
    if (!found) {
      throw Object.assign(new Error("Worktree not found on canvas"), {
        status: 404,
      });
    }

    const prompt = buildCreateOnlyPrompt(
      request.taskFile,
      request.doneFile,
      request.handoffId,
      request.workflowId,
      request.resultFile,
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
      handoffId: request.handoffId,
      repoPath: request.repoPath,
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
      if (!terminal) {
        return false;
      }
      return isLiveStatus(terminal.status);
    },
  };

  return {
    run(request) {
      return runWorkflow(
        {
          task: request.task,
          repoPath: request.repoPath,
          worktreePath: request.worktreePath,
          template: request.template,
          plannerType: request.allType ?? request.plannerType,
          implementerType: request.allType ?? request.implementerType,
          evaluatorType: request.allType ?? request.evaluatorType,
          timeoutMinutes: request.timeoutMinutes ?? 30,
          maxRetries: request.maxRetries ?? 1,
          autoApprove: request.autoApprove ?? true,
          approvePlan: request.approvePlan ?? false,
        },
        workflowDependencies,
      );
    },
    list(repoPath) {
      return listWorkflows(path.resolve(repoPath))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .map(buildWorkflowSummary);
    },
    status(repoPath, workflowId) {
      return getWorkflowStatus({ repoPath: path.resolve(repoPath), workflowId });
    },
    tick(repoPath, workflowId) {
      return tickWorkflow(
        { repoPath: path.resolve(repoPath), workflowId },
        workflowDependencies,
      );
    },
    retry(repoPath, workflowId) {
      return retryWorkflow(
        { repoPath: path.resolve(repoPath), workflowId },
        workflowDependencies,
      );
    },
    cleanup(repoPath, workflowId, force = false) {
      const resolvedRepo = path.resolve(repoPath);
      const workflow = loadWorkflow(resolvedRepo, workflowId);
      if (!workflow) {
        throw Object.assign(new Error(`Workflow not found: ${workflowId}`), {
          status: 404,
        });
      }

      const manager = new HandoffManager(resolvedRepo);
      for (const handoffId of workflow.handoff_ids) {
        const handoff = manager.load(handoffId);
        const terminalId = handoff?.dispatch?.active_terminal_id;
        if (!terminalId) {
          continue;
        }

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
            cwd: workflow.repo_path,
            stdio: "pipe",
          });
        } catch {
          // Worktree may already be removed.
        }
        if (workflow.branch) {
          try {
            execFileSync("git", buildGitBranchDeleteArgs(workflow.branch), {
              cwd: workflow.repo_path,
              stdio: "pipe",
            });
          } catch {
            // Branch may already be removed.
          }
        }
        syncProject(workflow.repo_path);
      }

      for (const handoffId of workflow.handoff_ids) {
        fs.rmSync(manager.getHandoffPath(handoffId), { force: true });
      }
      deleteWorkflow(resolvedRepo, workflowId);
      return { ok: true };
    },
  };
}
