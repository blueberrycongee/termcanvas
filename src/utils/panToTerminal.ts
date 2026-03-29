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
import { useTileDimensionsStore, setTrackSidebar, recomputeTileDimensions } from "../stores/tileDimensionsStore";

interface PanToTerminalOptions {
  /** Skip animation and set viewport immediately (e.g. during drag). */
  immediate?: boolean;
}

/**
 * Animate the canvas viewport to center on the given terminal.
 */
export function panToTerminal(terminalId: string, opts?: PanToTerminalOptions): void {
  setTrackSidebar(true);
  recomputeTileDimensions();

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

    const tileDims = useTileDimensionsStore.getState();
    const scale =
      Math.min(viewW / tileDims.w, viewH / tileDims.h) * 0.90;

    // Recompute position from the project store with current tile dims.
    // Published geometry may be stale after a tile-dim recomputation
    // (e.g. sidebar resized while no terminal was focused).
    let absX = publishedGeometry.x;
    let absY = publishedGeometry.y;
    let absH = publishedGeometry.h;
    const { projects } = useProjectStore.getState();
    const geomProject = projects.find((p) => p.id === publishedGeometry.projectId);
    const geomWorktree = geomProject?.worktrees.find(
      (w) => w.id === publishedGeometry.worktreeId,
    );
    if (geomProject && geomWorktree) {
      const idx = geomWorktree.terminals.findIndex((t) => t.id === terminalId);
      if (idx !== -1) {
        const packed = packTerminals(
          geomWorktree.terminals.map((t) => t.span),
        );
        const item = packed[idx];
        if (item) {
          absX =
            geomProject.position.x +
            PROJ_PAD +
            geomWorktree.position.x +
            WT_PAD +
            item.x;
          absY =
            geomProject.position.y +
            PROJ_TITLE_H +
            PROJ_PAD +
            geomWorktree.position.y +
            WT_TITLE_H +
            WT_PAD +
            item.y;
          absH = item.h;
        }
      }
    }

    const centerX = clampCenterX(
      absX,
      tileDims.w,
      scale,
      leftOffset,
      rightOffset,
    );
    const centerY =
      -(absY + absH / 2) * scale +
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

      const tileDims = useTileDimensionsStore.getState();
      const scale = Math.min(viewW / tileDims.w, viewH / tileDims.h) * 0.90;

      const centerX = clampCenterX(absX, tileDims.w, scale, leftOffset, rightOffset);
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
