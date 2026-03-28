import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { getCanvasRightInset, getCanvasLeftInset, clampCenterX } from "../canvas/viewportBounds";
import { useSelectionStore } from "../stores/selectionStore";
import {
  getWorktreeSize,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";

/**
 * Animate the canvas viewport to center on the given worktree.
 */
export function panToWorktree(projectId: string, worktreeId: string): void {
  const { projects } = useProjectStore.getState();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  const worktree = project.worktrees.find((w) => w.id === worktreeId);
  if (!worktree) return;

  const size = getWorktreeSize(
    worktree.terminals.map((t) => t.span),
    worktree.collapsed,
  );

  const absX = project.position.x + PROJ_PAD + worktree.position.x;
  const absY = project.position.y + PROJ_TITLE_H + PROJ_PAD + worktree.position.y;

  const { rightPanelCollapsed, leftPanelCollapsed, leftPanelWidth } =
    useCanvasStore.getState();
  const rightOffset = getCanvasRightInset(rightPanelCollapsed);
  const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const padding = 60;
  const viewW = window.innerWidth - rightOffset - padding * 2;
  const viewH = window.innerHeight - padding * 2;
  const scale = Math.min(viewW / size.w, viewH / size.h) * 0.85;

  const centerX = clampCenterX(absX, size.w, scale, leftOffset, rightOffset);
  const centerY = -(absY + size.h / 2) * scale + window.innerHeight / 2;

  useCanvasStore.getState().animateTo(centerX, centerY, scale);
  useSelectionStore.getState().selectWorktree(projectId, worktreeId);
}
