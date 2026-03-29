import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useSelectionStore } from "../stores/selectionStore";
import { getTerminalGeometry } from "../terminal/terminalGeometryRegistry";
import { getCanvasRightInset, getCanvasLeftInset, clampCenterX } from "../canvas/viewportBounds";
import {
  packTerminals,
  PROJ_PAD,
  PROJ_TITLE_H,
  WT_PAD,
  WT_TITLE_H,
} from "../layout";
import { computeTileDimensions } from "../stores/tileDimensionsStore";
import { useFocusTileSizeStore } from "../stores/focusTileSizeStore";

interface PanToTerminalOptions {
  /** Skip animation and set viewport immediately (e.g. during drag). */
  immediate?: boolean;
}

/**
 * Animate the canvas viewport to center on the given terminal.
 */
export function panToTerminal(terminalId: string, opts?: PanToTerminalOptions): void {
  const publishedGeometry = getTerminalGeometry(terminalId);
  if (publishedGeometry) {
    const { rightPanelCollapsed, leftPanelCollapsed, leftPanelWidth } =
      useCanvasStore.getState();
    const rightOffset = getCanvasRightInset(rightPanelCollapsed);
    const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
    const padding = 40;
    const topInset = 56;
    const viewW = window.innerWidth - leftOffset - rightOffset - padding * 2;
    const viewH = window.innerHeight - padding * 2;

    // Compute ideal tile size for this viewport and set override
    const ideal = computeTileDimensions(window.innerWidth, window.innerHeight, leftOffset, rightOffset);
    useFocusTileSizeStore.getState().set(terminalId, ideal.w, ideal.h);

    const scale =
      Math.min(viewW / ideal.w, viewH / ideal.h) * 0.90;

    const centerX = clampCenterX(
      publishedGeometry.x,
      ideal.w,
      scale,
      leftOffset,
      rightOffset,
    );
    const centerY =
      -(publishedGeometry.y + publishedGeometry.h / 2) * scale +
      (topInset + window.innerHeight) / 2;

    if (opts?.immediate) {
      useCanvasStore.getState().setViewport({ x: centerX, y: centerY, scale });
    } else {
      useCanvasStore.getState().animateTo(centerX, centerY, scale);
    }
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

      const { rightPanelCollapsed, leftPanelCollapsed, leftPanelWidth } =
        useCanvasStore.getState();
      const rightOffset = getCanvasRightInset(rightPanelCollapsed);
      const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
      const padding = 40;
      const topInset = 56;
      const viewW = window.innerWidth - leftOffset - rightOffset - padding * 2;
      const viewH = window.innerHeight - padding * 2;

      const ideal = computeTileDimensions(window.innerWidth, window.innerHeight, leftOffset, rightOffset);
      useFocusTileSizeStore.getState().set(terminalId, ideal.w, ideal.h);

      const scale = Math.min(viewW / ideal.w, viewH / ideal.h) * 0.90;

      const centerX = clampCenterX(absX, ideal.w, scale, leftOffset, rightOffset);
      const centerY = -(absY + item.h / 2) * scale + (topInset + window.innerHeight) / 2;

      if (opts?.immediate) {
        useCanvasStore.getState().setViewport({ x: centerX, y: centerY, scale });
      } else {
        useCanvasStore.getState().animateTo(centerX, centerY, scale);
      }
      useSelectionStore
        .getState()
        .selectTerminal(focusedProject.id, focusedWorktree.id, terminalId);
      return;
    }
  }

  console.warn(`[panToTerminal] terminal ${terminalId} not found`);
}
