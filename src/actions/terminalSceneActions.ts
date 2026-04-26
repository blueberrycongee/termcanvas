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
import { recordRenderDiagnostic } from "../terminal/renderDiagnostics";
import { pickPlacement } from "../canvas/terminalPlacement";
import { useCanvasStore } from "../stores/canvasStore";
import { usePinStore } from "../stores/pinStore";
import { getVisibleCanvasWorldRect } from "../canvas/viewportBounds";

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

interface WorktreeGroupMovePreview {
  positions: Map<string, { x: number; y: number }>;
  worktreeOffset: { x: number; y: number };
}

function snapToGrid(value: number, grid = 10) {
  return Math.round(value / grid) * grid;
}

function collectWorktreeTerminals(projectId: string, worktreeId: string) {
  const project = useProjectStore
    .getState()
    .projects.find((candidate) => candidate.id === projectId);
  const worktree = project?.worktrees.find(
    (candidate) => candidate.id === worktreeId,
  );
  return worktree?.terminals.filter((terminal) => !terminal.stashed) ?? [];
}

export function addTerminalToScene(
  projectId: string,
  worktreeId: string,
  terminal: TerminalData,
): TerminalData {
  useProjectStore.getState().addTerminal(projectId, worktreeId, terminal);
  return terminal;
}

export function buildWorktreeGroupMove(
  projectId: string,
  worktreeId: string,
  deltaX: number,
  deltaY: number,
): WorktreeGroupMovePreview | null {
  const terminals = collectWorktreeTerminals(projectId, worktreeId);
  if (terminals.length === 0) {
    return null;
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const terminal of terminals) {
    positions.set(terminal.id, {
      x: terminal.x + deltaX,
      y: terminal.y + deltaY,
    });
  }

  return {
    positions,
    worktreeOffset: { x: deltaX, y: deltaY },
  };
}

export function commitWorktreeGroupMove(
  projectId: string,
  worktreeId: string,
  preview: WorktreeGroupMovePreview,
): void {
  const terminals = collectWorktreeTerminals(projectId, worktreeId);
  if (terminals.length === 0) {
    return;
  }

  const updates = terminals.map((terminal) => {
    const next = preview.positions.get(terminal.id);
    return {
      projectId,
      worktreeId,
      terminalId: terminal.id,
      x: snapToGrid(next?.x ?? terminal.x),
      y: snapToGrid(next?.y ?? terminal.y),
    };
  });

  useProjectStore.getState().updateTerminalPositions(updates);
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
  const canvasState = useCanvasStore.getState();
  const viewportRect =
    typeof window !== "undefined"
      ? getVisibleCanvasWorldRect(
          canvasState.viewport,
          canvasState.rightPanelCollapsed,
          canvasState.leftPanelCollapsed,
          canvasState.leftPanelWidth,
          canvasState.rightPanelWidth,
          usePinStore.getState().openProjectPath !== null,
        )
      : undefined;
  const placement = pickPlacement({
    projects: projectStore.projects,
    projectId,
    worktreeId,
    parentTerminalId,
    width: baseTerminal.width,
    height: baseTerminal.height,
    preferredPosition: position,
    viewportRect,
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
  recordRenderDiagnostic({
    kind: "focus_terminal_in_scene",
    terminalId: terminalId ?? undefined,
    data: {
      focus_composer: options?.focusComposer ?? false,
      focus_input: options?.focusInput ?? false,
    },
  });
  useProjectStore.getState().setFocusedTerminal(terminalId, options);
}

export function closeTerminalInScene(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  destroyTerminalRuntime(terminalId, {
    caller: "closeTerminalInScene",
    reason: "close_terminal",
  });
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
