import {
  activateTerminalInScene,
  selectTerminalInScene,
} from "../actions/sceneSelectionActions";
import { focusTerminalInScene } from "../actions/terminalSceneActions";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import {
  getCanvasRightInset,
  getCanvasLeftInset,
  clampCenterX,
} from "../canvas/viewportBounds";
import {
  setTrackSidebar,
  recomputeTileDimensions,
} from "../stores/tileDimensionsStore";

interface PanToTerminalOptions {
  immediate?: boolean;
  preserveScale?: boolean;
}

function findTerminal(terminalId: string) {
  const { projects } = useProjectStore.getState();
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.id === terminalId) {
          return { terminal: t, projectId: p.id, worktreeId: w.id };
        }
      }
    }
  }
  return null;
}

function isAlreadyFocused(terminalId: string): boolean {
  const { projects } = useProjectStore.getState();
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.focused) return t.id === terminalId;
      }
    }
  }
  return false;
}

/**
 * Animate the canvas viewport to center on the given terminal.
 */
export function panToTerminal(
  terminalId: string,
  opts?: PanToTerminalOptions,
): void {
  setTrackSidebar(true);
  recomputeTileDimensions();

  const found = findTerminal(terminalId);
  if (!found) {
    console.warn(`[panToTerminal] terminal ${terminalId} not found`);
    return;
  }

  const { terminal, projectId, worktreeId } = found;
  const absX = terminal.x;
  const absY = terminal.y;
  const absW = terminal.width;
  const absH = terminal.height;

  const canvasState = useCanvasStore.getState();
  const {
    rightPanelCollapsed,
    rightPanelWidth,
    leftPanelCollapsed,
    leftPanelWidth,
    viewport,
  } = canvasState;
  const rightOffset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth);
  const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const padding = 40;
  const topInset = 56;
  const viewW = window.innerWidth - leftOffset - rightOffset - padding * 2;
  const viewH = window.innerHeight - padding * 2;

  const scale = opts?.preserveScale
    ? viewport.scale
    : Math.min(viewW / absW, viewH / absH) * 0.9;

  const centerX = clampCenterX(absX, absW, scale, leftOffset, rightOffset);
  const centerY =
    -(absY + absH / 2) * scale + (topInset + window.innerHeight) / 2;

  if (opts?.immediate) {
    useCanvasStore.getState().setViewport({ x: centerX, y: centerY, scale });
  } else {
    useCanvasStore.getState().animateTo(centerX, centerY, scale);
  }

  const shouldFocusTerminal = !isAlreadyFocused(terminalId);
  if (shouldFocusTerminal) {
    focusTerminalInScene(terminalId);
    activateTerminalInScene(projectId, worktreeId, terminalId);
  } else {
    selectTerminalInScene(projectId, worktreeId, terminalId);
  }
}
