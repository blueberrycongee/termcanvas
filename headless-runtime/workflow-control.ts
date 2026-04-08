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
import { AssignmentManager } from "../hydra/src/assignment/manager.ts";
import type { AgentType } from "../hydra/src/assignment/types.ts";
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
  template?: "single-step" | "researcher-implementer-tester";
  allType?: AgentType;
  researcherType?: AgentType;
  implementerType?: AgentType;
  testerType?: AgentType;
  timeoutMinutes?: number;
  maxRetries?: number;
  autoApprove?: boolean;
}

export interface WorkflowSummary {
  id: string;
  status: WorkflowRecord["status"];
  task: string;
  worktree_path: string;
  current_assignment_id: string;
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
    current_assignment_id: record.current_assignment_id,
    updated_at: record.updated_at,
  };
}

function buildWorkflowEventPayload(view: WorkflowStatusView): Record<string, unknown> {
  const currentAssignment = view.assignments.find(
    (assignment) => assignment.id === view.workflow.current_assignment_id,
  );
  const activeRun = currentAssignment?.active_run_id
    ? currentAssignment.runs.find((run) => run.id === currentAssignment.active_run_id)
    : currentAssignment?.runs[currentAssignment.runs.length - 1];
  return {
    workflowId: view.workflow.id,
    assignmentId: view.workflow.current_assignment_id,
    repoPath: view.workflow.repo_path,
    terminalId: activeRun?.terminal_id,
  };
}

function emitWorkflowEvent(
  eventBus: ServerEventBus | undefined,
  type: "workflow_started" | "workflow_completed" | "workflow_failed",
  view: WorkflowStatusView,
): void {
  eventBus?.emit(type, buildWorkflowEventPayload(view));
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
      request.workflowId,
      request.resultFile,
      {
        assignmentId: request.assignmentId,
        runId: request.runId,
      },
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
    async run(request) {
      const view = await runWorkflow(
        {
          task: request.task,
          repoPath: request.repoPath,
          worktreePath: request.worktreePath,
          template: request.template,
          researcherType: request.allType ?? request.researcherType,
          implementerType: request.allType ?? request.implementerType,
          testerType: request.allType ?? request.testerType,
          timeoutMinutes: request.timeoutMinutes ?? 30,
          maxRetries: request.maxRetries ?? 1,
          autoApprove: request.autoApprove ?? true,
        },
        workflowDependencies,
      );
      emitWorkflowEvent(input.eventBus, "workflow_started", view);
      return view;
    },
    list(repoPath) {
      return listWorkflows(path.resolve(repoPath))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .map(buildWorkflowSummary);
    },
    status(repoPath, workflowId) {
      return getWorkflowStatus({ repoPath: path.resolve(repoPath), workflowId });
    },
    async tick(repoPath, workflowId) {
      const previous = loadWorkflow(path.resolve(repoPath), workflowId);
      const view = await tickWorkflow(
        { repoPath: path.resolve(repoPath), workflowId },
        workflowDependencies,
      );
      if (view.workflow.status === "completed" && previous?.status !== "completed") {
        emitWorkflowEvent(input.eventBus, "workflow_completed", view);
      } else if (view.workflow.status === "failed" && previous?.status !== "failed") {
        emitWorkflowEvent(input.eventBus, "workflow_failed", view);
      }
      return view;
    },
    async retry(repoPath, workflowId) {
      const previous = loadWorkflow(path.resolve(repoPath), workflowId);
      const view = await retryWorkflow(
        { repoPath: path.resolve(repoPath), workflowId },
        workflowDependencies,
      );
      if (view.workflow.status === "completed" && previous?.status !== "completed") {
        emitWorkflowEvent(input.eventBus, "workflow_completed", view);
      } else if (view.workflow.status === "failed" && previous?.status !== "failed") {
        emitWorkflowEvent(input.eventBus, "workflow_failed", view);
      }
      return view;
    },
    cleanup(repoPath, workflowId, force = false) {
      const resolvedRepo = path.resolve(repoPath);
      const workflow = loadWorkflow(resolvedRepo, workflowId);
      if (!workflow) {
        throw Object.assign(new Error(`Workflow not found: ${workflowId}`), {
          status: 404,
        });
      }

      const manager = new AssignmentManager(resolvedRepo, workflowId);
      for (const assignmentId of workflow.assignment_ids) {
        const assignment = manager.load(assignmentId);
        const activeRun = assignment?.active_run_id
          ? assignment.runs.find((run) => run.id === assignment.active_run_id)
          : assignment?.runs[assignment.runs.length - 1];
        const terminalId = activeRun?.terminal_id;
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
        }
        if (workflow.branch) {
          try {
            execFileSync("git", buildGitBranchDeleteArgs(workflow.branch), {
              cwd: workflow.repo_path,
              stdio: "pipe",
            });
          } catch {
          }
        }
        syncProject(workflow.repo_path);
      }

      deleteWorkflow(resolvedRepo, workflowId);
      return { ok: true };
    },
  };
}
