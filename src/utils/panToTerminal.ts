import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
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

      const { rightPanelCollapsed, rightPanelWidth } = useCanvasStore.getState();
      const rightOffset = rightPanelCollapsed ? 0 : rightPanelWidth;
      const padding = 60;
      const viewW = window.innerWidth - rightOffset - padding * 2;
      const viewH = window.innerHeight - padding * 2;
      const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

      const centerX = -(absX + item.w / 2) * scale + (window.innerWidth - rightOffset) / 2;
      const centerY = -(absY + item.h / 2) * scale + window.innerHeight / 2;

      useCanvasStore.getState().animateTo(centerX, centerY, scale);
      useProjectStore.getState().setFocusedTerminal(terminalId);
      return;
    }
  }

  console.warn(`[panToTerminal] terminal ${terminalId} not found`);
}
