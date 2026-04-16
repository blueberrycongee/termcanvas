import { HydraError } from "./errors.ts";
import {
  findProjectByPath,
  isTermCanvasRunning,
  terminalCreate,
} from "./termcanvas.ts";

export interface DispatchCreateOnlyRequest {
  workbenchId: string;
  assignmentId: string;
  runId: string;
  repoPath: string;
  worktreePath: string;
  agentType: string;
  /**
   * Optional model pin (e.g. "opus", "gpt-5"). When set, the underlying CLI
   * is invoked with its model flag via the CLI adapter.
   */
  model?: string;
  /**
   * Optional reasoning effort level using the target CLI's native vocabulary
   * (claude: low|medium|high|max; codex: low|medium|high|xhigh). Validated
   * against the adapter's capability before launch.
   */
  reasoningEffort?: string;
  taskFile: string;
  resultFile: string;
  autoApprove?: boolean;
  parentTerminalId?: string;
  // Resume the agent's prior session (e.g., for redispatch after reset).
  // Only consumed by agents that support session resumption (currently claude).
  resumeSessionId?: string;
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
    workbenchId?: string,
    assignmentId?: string,
    repoPath?: string,
    resumeSessionId?: string,
  ): { id: string; type: string; title: string };
}

const DEFAULT_DEPENDENCIES: DispatcherDependencies = {
  isTermCanvasRunning,
  findProjectByPath,
  terminalCreate,
};

export function buildCreateOnlyPrompt(
  taskFile: string,
  workbenchId: string,
  resultFile: string,
  options: {
    assignmentId: string;
    runId: string;
  },
): string {
  return `You MUST read ${taskFile} FIRST — before any other action. It is the single source of truth for your task, context files, output paths, and the result.json contract. Do not write code, run commands, or plan until you have read it.`;
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
        workbench_id: request.workbenchId,
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
        workbench_id: request.workbenchId,
        assignment_id: request.assignmentId,
      },
    });
  }

  const prompt = buildCreateOnlyPrompt(
    request.taskFile,
    request.workbenchId,
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
    request.workbenchId,
    request.assignmentId,
    request.repoPath,
    request.resumeSessionId,
  );

  return {
    projectId: project.id,
    terminalId: terminal.id,
    terminalType: terminal.type,
    terminalTitle: terminal.title,
    prompt,
  };
}
