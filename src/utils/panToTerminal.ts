import { useProjectStore } from "../stores/projectStore.ts";
import { useCanvasStore } from "../stores/canvasStore.ts";
import {
  packTerminals,
  PROJ_PAD,
  PROJ_TITLE_H,
  WT_PAD,
  WT_TITLE_H,
} from "../layout.ts";
import {
  getCenteredViewportTarget,
  getViewportFitScale,
} from "./canvasViewport.ts";

/**
 * Animate the canvas viewport to center on the given terminal.
 */
export function panToTerminal(terminalId: string): void {
  const { projects } = useProjectStore.getState();

  for (const p of projects) {
    for (const w of p.worktrees) {
      const index = w.terminals.findIndex((t) => t.id === terminalId);
      if (index === -1) continue;

      const packed = packTerminals(w.terminals.map((t) => t.span));
      const item = packed[index];
      if (!item) return;

      const absX = p.position.x + PROJ_PAD + w.position.x + WT_PAD + item.x;
      const absY = p.position.y + PROJ_TITLE_H + PROJ_PAD + w.position.y + WT_TITLE_H + WT_PAD + item.y;

      const { rightPanelCollapsed } = useCanvasStore.getState();
      const scale =
        getViewportFitScale(item.w, item.h, {
          rightPanelCollapsed,
          padding: 60,
        }) * 0.85;
      const target = getCenteredViewportTarget(absX, absY, item.w, item.h, {
        rightPanelCollapsed,
        scale,
      });

      useCanvasStore.getState().animateTo(target.x, target.y, scale);
      useProjectStore.getState().setFocusedTerminal(terminalId);
      return;
    }
  }

  console.warn(`[panToTerminal] terminal ${terminalId} not found`);
}
