import { useProjectStore } from "../stores/projectStore.ts";
import {
  COLLAPSED_TAB_WIDTH,
  RIGHT_PANEL_WIDTH,
  useCanvasStore,
} from "../stores/canvasStore.ts";
import {
  getWorktreeSize,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout.ts";

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

  const { rightPanelCollapsed } = useCanvasStore.getState();
  const rightOffset = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;
  const padding = 60;
  const viewW = window.innerWidth - rightOffset - padding * 2;
  const viewH = window.innerHeight - padding * 2;
  const scale = Math.min(viewW / size.w, viewH / size.h) * 0.85;

  const centerX =
    -(absX + size.w / 2) * scale + (window.innerWidth - rightOffset) / 2;
  const centerY = -(absY + size.h / 2) * scale + window.innerHeight / 2;

  useCanvasStore.getState().animateTo(centerX, centerY, scale);
}
