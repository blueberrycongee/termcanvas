import { selectWorktreeInScene } from "../actions/sceneSelectionActions";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useViewportFocusStore } from "../stores/viewportFocusStore";
import {
  getCanvasRightInset,
  getCanvasLeftInset,
  clampCenterX,
} from "../canvas/viewportBounds";

interface PanToWorktreeOptions {
  /** When true, enter overview mode so double-clicking a terminal zooms into it. */
  enterOverview?: boolean;
}

/**
 * Animate the canvas viewport to center on the given worktree.
 * Computes bounds from all non-stashed terminals in the worktree.
 */
export function panToWorktree(
  projectId: string,
  worktreeId: string,
  options?: PanToWorktreeOptions,
): void {
  const { projects } = useProjectStore.getState();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  const worktree = project.worktrees.find((w) => w.id === worktreeId);
  if (!worktree) return;

  const terminals = worktree.terminals.filter((t) => !t.stashed);
  if (terminals.length === 0) return;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const t of terminals) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.width);
    maxY = Math.max(maxY, t.y + t.height);
  }

  const absX = minX;
  const absY = minY;
  const sizeW = maxX - minX;
  const sizeH = maxY - minY;

  const {
    rightPanelCollapsed,
    rightPanelWidth,
    leftPanelCollapsed,
    leftPanelWidth,
  } = useCanvasStore.getState();
  const rightOffset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth);
  const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const padding = 60;
  const viewW = window.innerWidth - leftOffset - rightOffset - padding * 2;
  const viewH = window.innerHeight - padding * 2;
  const scale = Math.min(viewW / sizeW, viewH / sizeH) * 0.85;

  const centerX = clampCenterX(absX, sizeW, scale, leftOffset, rightOffset);
  const centerY = -(absY + sizeH / 2) * scale + window.innerHeight / 2;

  useCanvasStore.getState().animateTo(centerX, centerY, scale);
  selectWorktreeInScene(projectId, worktreeId);

  if (options?.enterOverview) {
    useViewportFocusStore.getState().setFitAllScale(scale);
    useViewportFocusStore.getState().setZoomedOutTerminalId(terminals[0].id);
  }
}
