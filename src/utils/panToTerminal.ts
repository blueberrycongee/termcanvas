import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useSelectionStore } from "../stores/selectionStore";
import { getTerminalGeometry } from "../terminal/terminalGeometryRegistry";
import { getCanvasRightInset } from "../canvas/viewportBounds";
import {
  packTerminals,
  PROJ_PAD,
  PROJ_TITLE_H,
  WT_PAD,
  WT_TITLE_H,
} from "../layout";

/**
 * Animate the canvas viewport to center on the given terminal.
 */
export function panToTerminal(terminalId: string): void {
  const publishedGeometry = getTerminalGeometry(terminalId);
  if (publishedGeometry) {
    const { rightPanelCollapsed } = useCanvasStore.getState();
    const rightOffset = getCanvasRightInset(rightPanelCollapsed);
    const padding = 60;
    const viewW = window.innerWidth - rightOffset - padding * 2;
    const viewH = window.innerHeight - padding * 2;
    const scale =
      Math.min(viewW / publishedGeometry.w, viewH / publishedGeometry.h) * 0.85;

    const centerX =
      -(publishedGeometry.x + publishedGeometry.w / 2) * scale +
      (window.innerWidth - rightOffset) / 2;
    const centerY =
      -(publishedGeometry.y + publishedGeometry.h / 2) * scale +
      window.innerHeight / 2;

    useCanvasStore.getState().animateTo(centerX, centerY, scale);
    useProjectStore.getState().setFocusedTerminal(terminalId);
    useSelectionStore
      .getState()
      .selectTerminal(
        publishedGeometry.projectId,
        publishedGeometry.worktreeId,
        terminalId,
      );
    return;
  }

  const { projects } = useProjectStore.getState();

  for (const p of projects) {
    for (const w of p.worktrees) {
      const index = w.terminals.findIndex((t) => t.id === terminalId);
      if (index === -1) continue;

      useProjectStore.getState().setFocusedTerminal(terminalId);
      const { projects: focusedProjects } = useProjectStore.getState();
      const focusedProject = focusedProjects.find((candidate) => candidate.id === p.id);
      const focusedWorktree = focusedProject?.worktrees.find(
        (candidate) => candidate.id === w.id,
      );
      if (!focusedProject || !focusedWorktree) {
        return;
      }

      const focusedIndex = focusedWorktree.terminals.findIndex(
        (terminal) => terminal.id === terminalId,
      );
      if (focusedIndex === -1) {
        return;
      }

      const packed = packTerminals(
        focusedWorktree.terminals.map((terminal) => terminal.span),
      );
      const item = packed[focusedIndex];
      if (!item) return;

      const absX =
        focusedProject.position.x +
        PROJ_PAD +
        focusedWorktree.position.x +
        WT_PAD +
        item.x;
      const absY =
        focusedProject.position.y +
        PROJ_TITLE_H +
        PROJ_PAD +
        focusedWorktree.position.y +
        WT_TITLE_H +
        WT_PAD +
        item.y;

      const { rightPanelCollapsed } = useCanvasStore.getState();
      const rightOffset = getCanvasRightInset(rightPanelCollapsed);
      const padding = 60;
      const viewW = window.innerWidth - rightOffset - padding * 2;
      const viewH = window.innerHeight - padding * 2;
      const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

      const centerX = -(absX + item.w / 2) * scale + (window.innerWidth - rightOffset) / 2;
      const centerY = -(absY + item.h / 2) * scale + window.innerHeight / 2;

      useCanvasStore.getState().animateTo(centerX, centerY, scale);
      useSelectionStore
        .getState()
        .selectTerminal(focusedProject.id, focusedWorktree.id, terminalId);
      return;
    }
  }

  console.warn(`[panToTerminal] terminal ${terminalId} not found`);
}
