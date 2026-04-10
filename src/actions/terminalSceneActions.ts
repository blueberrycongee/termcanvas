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
import { pickPlacement } from "../canvas/terminalPlacement";

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
  position?: { x: number; y: number };
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
  position,
}: CreateTerminalInSceneOptions): TerminalData {
  const baseTerminal =
    terminal ??
    createProjectTerminal(
      type,
      title,
      initialPrompt,
      autoApprove,
      origin,
      parentTerminalId,
    );

  // Compute placement if the caller did not specify explicit x/y on the
  // terminal record. The default createTerminal() returns x=0, y=0, so we
  // treat that as "needs auto placement".
  const projectStore = useProjectStore.getState();
  const placement = pickPlacement({
    projects: projectStore.projects,
    projectId,
    worktreeId,
    parentTerminalId,
    width: baseTerminal.width,
    height: baseTerminal.height,
    preferredPosition: position,
  });

  const placedTerminal: TerminalData = {
    ...baseTerminal,
    x: placement.x,
    y: placement.y,
  };

  // Apply collision-resolved nudges to existing tiles.
  for (const nudge of placement.nudged) {
    for (const project of projectStore.projects) {
      for (const worktree of project.worktrees) {
        if (worktree.terminals.some((t) => t.id === nudge.id)) {
          projectStore.updateTerminalPosition(
            project.id,
            worktree.id,
            nudge.id,
            nudge.x,
            nudge.y,
          );
        }
      }
    }
  }

  return addTerminalToScene(projectId, worktreeId, placedTerminal);
}

export function focusTerminalInScene(
  terminalId: string | null,
  options?: { focusComposer?: boolean; focusInput?: boolean },
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
