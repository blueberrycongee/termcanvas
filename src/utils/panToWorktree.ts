import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import {
  computeWorktreeSize,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";
import {
  getCenteredViewportTarget,
  getViewportFitScale,
} from "./canvasViewport";

/**
 * Animate the canvas viewport to center on the given worktree.
 */
export function panToWorktree(projectId: string, worktreeId: string): void {
  const { projects } = useProjectStore.getState();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  const worktree = project.worktrees.find((w) => w.id === worktreeId);
  if (!worktree) return;

  const size = computeWorktreeSize(worktree.terminals.map((t) => t.span));

  const absX = project.position.x + PROJ_PAD + worktree.position.x;
  const absY = project.position.y + PROJ_TITLE_H + PROJ_PAD + worktree.position.y;

  const { rightPanelCollapsed } = useCanvasStore.getState();
  const scale =
    getViewportFitScale(size.w, size.h, {
      rightPanelCollapsed,
      padding: 60,
    }) * 0.85;
  const target = getCenteredViewportTarget(absX, absY, size.w, size.h, {
    rightPanelCollapsed,
    scale,
  });

  useCanvasStore.getState().animateTo(target.x, target.y, scale);
}
