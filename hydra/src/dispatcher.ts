import { HydraError } from "./errors.ts";
import {
  findProjectByPath,
  isTermCanvasRunning,
  terminalCreate,
} from "./termcanvas.ts";

export interface DispatchCreateOnlyRequest {
  workflowId: string;
  handoffId: string;
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
  ): { id: string; type: string; title: string };
}

const DEFAULT_DEPENDENCIES: DispatcherDependencies = {
  isTermCanvasRunning,
  findProjectByPath,
  terminalCreate,
};

export function buildCreateOnlyPrompt(taskFile: string, resultFile: string): string {
  return `Read ${taskFile} for the full task contract. Write result JSON to ${resultFile}, then write the done marker described in the task package.`;
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
        handoff_id: request.handoffId,
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
        handoff_id: request.handoffId,
      },
    });
  }

  const prompt = buildCreateOnlyPrompt(request.taskFile, request.resultFile);
  const terminal = dependencies.terminalCreate(
    request.worktreePath,
    request.agentType,
    prompt,
    request.autoApprove,
    request.parentTerminalId,
  );

  return {
    projectId: project.id,
    terminalId: terminal.id,
    terminalType: terminal.type,
    terminalTitle: terminal.title,
    prompt,
  };
}
