import { HydraError } from "./errors.ts";
import {
  findProjectByPath,
  isTermCanvasRunning,
  terminalCreate,
} from "./termcanvas.ts";

export interface DispatchCreateOnlyRequest {
  workflowId: string;
  assignmentId: string;
  runId: string;
  repoPath: string;
  worktreePath: string;
  agentType: string;
  taskFile: string;
  resultFile: string;
  autoApprove?: boolean;
  parentTerminalId?: string;
}

export interface DispatchCreateOnlyResult {
  projectId: string;
  terminalId: string;
  terminalType: string;
  terminalTitle: string;
  prompt: string;
}

export interface DispatcherDependencies {
  isTermCanvasRunning(): boolean;
  findProjectByPath(repoPath: string): { id: string; path: string } | null;
  terminalCreate(
    worktreePath: string,
    type: string,
    prompt?: string,
    autoApprove?: boolean,
    parentTerminalId?: string,
    workflowId?: string,
    assignmentId?: string,
    repoPath?: string,
  ): { id: string; type: string; title: string };
}

const DEFAULT_DEPENDENCIES: DispatcherDependencies = {
  isTermCanvasRunning,
  findProjectByPath,
  terminalCreate,
};

export function buildCreateOnlyPrompt(
  taskFile: string,
  workflowId: string,
  resultFile: string,
  options: {
    assignmentId: string;
    runId: string;
  },
): string {
  return `Read ${taskFile} for the full task instructions. Finish every required artifact first, then publish a valid hydra/result/v1 result JSON to ${resultFile} with workflow_id=${workflowId}, assignment_id=${options.assignmentId}, and run_id=${options.runId}. Publish result.json atomically as the final commit for this run.`;
}

export async function dispatchCreateOnly(
  request: DispatchCreateOnlyRequest,
  dependencies: DispatcherDependencies = DEFAULT_DEPENDENCIES,
): Promise<DispatchCreateOnlyResult> {
  if (!dependencies.isTermCanvasRunning()) {
    throw new HydraError("TermCanvas is not running", {
      errorCode: "DISPATCH_TERMCANVAS_NOT_RUNNING",
      stage: "dispatcher.preflight",
      ids: {
        workflow_id: request.workflowId,
        assignment_id: request.assignmentId,
      },
    });
  }

  const project = dependencies.findProjectByPath(request.repoPath);
  if (!project) {
    throw new HydraError(`Repo not found on TermCanvas canvas: ${request.repoPath}`, {
      errorCode: "DISPATCH_REPO_NOT_ON_CANVAS",
      stage: "dispatcher.preflight",
      ids: {
        workflow_id: request.workflowId,
        assignment_id: request.assignmentId,
      },
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
  const terminal = dependencies.terminalCreate(
    request.worktreePath,
    request.agentType,
    prompt,
    request.autoApprove,
    request.parentTerminalId,
    request.workflowId,
    request.assignmentId,
    request.repoPath,
  );

  return {
    projectId: project.id,
    terminalId: terminal.id,
    terminalType: terminal.type,
    terminalTitle: terminal.title,
    prompt,
  };
}
