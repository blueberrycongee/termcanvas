import type { TerminalData, TerminalOrigin, TerminalType } from "../types";
import {
  createTerminal as createProjectTerminal,
  destroyAllStashedTerminals as destroyAllProjectStashedTerminals,
  destroyStashedTerminal as destroyProjectStashedTerminal,
  stashTerminal as stashProjectTerminal,
  unstashTerminal as unstashProjectTerminal,
  useProjectStore,
} from "../stores/projectStore";
import { destroyTerminalRuntime } from "../terminal/terminalRuntimeStore";

interface CreateTerminalInSceneOptions {
  projectId: string;
  worktreeId: string;
  terminal?: TerminalData;
  type?: TerminalType;
  title?: string;
  initialPrompt?: string;
  autoApprove?: boolean;
  origin?: TerminalOrigin;
  parentTerminalId?: string;
}

export function addTerminalToScene(
  projectId: string,
  worktreeId: string,
  terminal: TerminalData,
): TerminalData {
  useProjectStore.getState().addTerminal(projectId, worktreeId, terminal);
  return terminal;
}

export function createTerminalInScene({
  projectId,
  worktreeId,
  terminal,
  type = "shell",
  title,
  initialPrompt,
  autoApprove,
  origin = "user",
  parentTerminalId,
}: CreateTerminalInSceneOptions): TerminalData {
  return addTerminalToScene(
    projectId,
    worktreeId,
    terminal ??
      createProjectTerminal(
        type,
        title,
        initialPrompt,
        autoApprove,
        origin,
        parentTerminalId,
      ),
  );
}

export function focusTerminalInScene(
  terminalId: string | null,
  options?: { focusComposer?: boolean },
): void {
  useProjectStore.getState().setFocusedTerminal(terminalId, options);
}

export function closeTerminalInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  destroyTerminalRuntime(terminalId);
  useProjectStore.getState().removeTerminal(projectId, worktreeId, terminalId);
}

export function updateTerminalCustomTitleInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
  customTitle: string,
): void {
  useProjectStore
    .getState()
    .updateTerminalCustomTitle(projectId, worktreeId, terminalId, customTitle);
}

export function toggleTerminalStarredInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  useProjectStore
    .getState()
    .toggleTerminalStarred(projectId, worktreeId, terminalId);
}

export function toggleTerminalMinimizeInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  useProjectStore
    .getState()
    .toggleTerminalMinimize(projectId, worktreeId, terminalId);
}

export function updateTerminalSpanInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
  span: { cols: number; rows: number },
): void {
  useProjectStore
    .getState()
    .updateTerminalSpan(projectId, worktreeId, terminalId, span);
}

export function stashTerminalInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  stashProjectTerminal(projectId, worktreeId, terminalId);
}

export function unstashTerminalInScene(terminalId: string): void {
  unstashProjectTerminal(terminalId);
}

export function destroyStashedTerminalInScene(terminalId: string): void {
  destroyProjectStashedTerminal(terminalId);
}

export function destroyAllStashedTerminalsInScene(): void {
  destroyAllProjectStashedTerminals();
}
