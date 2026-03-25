import type { Viewport } from "../types";
import {
  COLLAPSED_TAB_WIDTH,
  RIGHT_PANEL_WIDTH,
} from "../stores/canvasStore";

export function getCanvasRightInset(rightPanelCollapsed: boolean) {
  return rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;
}

export function rectIntersectsCanvasViewport(
  rect: { x: number; y: number; w: number; h: number },
  viewport: Viewport,
  rightPanelCollapsed: boolean,
  margin = 120,
) {
  const left = -viewport.x / viewport.scale - margin;
  const top = -viewport.y / viewport.scale - margin;
  const right =
    left +
    (window.innerWidth - getCanvasRightInset(rightPanelCollapsed)) /
      viewport.scale +
    margin * 2;
  const bottom = top + window.innerHeight / viewport.scale + margin * 2;

  return (
    rect.x < right &&
    rect.x + rect.w > left &&
    rect.y < bottom &&
    rect.y + rect.h > top
  );
}
