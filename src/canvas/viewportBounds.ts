import type { Viewport } from "../types";
import {
  COLLAPSED_TAB_WIDTH,
  RIGHT_PANEL_WIDTH,
} from "../stores/canvasStore";

export function getCanvasRightInset(rightPanelCollapsed: boolean) {
  return rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;
}

export function getCanvasLeftInset(
  leftPanelCollapsed: boolean,
  leftPanelWidth: number,
) {
  return leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;
}

export function canvasPointToScreenPoint(
  x: number,
  y: number,
  viewport: Viewport,
  leftPanelCollapsed: boolean,
  leftPanelWidth: number,
) {
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  return {
    x: leftInset + viewport.x + x * viewport.scale,
    y: viewport.y + y * viewport.scale,
  };
}

export function screenPointToCanvasPoint(
  clientX: number,
  clientY: number,
  viewport: Viewport,
  leftPanelCollapsed: boolean,
  leftPanelWidth: number,
) {
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  return {
    x: (clientX - leftInset - viewport.x) / viewport.scale,
    y: (clientY - viewport.y) / viewport.scale,
  };
}

export function rectIntersectsCanvasViewport(
  rect: { x: number; y: number; w: number; h: number },
  viewport: Viewport,
  rightPanelCollapsed: boolean,
  leftPanelCollapsed: boolean,
  leftPanelWidth: number,
  margin = 120,
) {
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const left = -viewport.x / viewport.scale - margin;
  const top = -viewport.y / viewport.scale - margin;
  const right =
    left +
    (window.innerWidth - leftInset - getCanvasRightInset(rightPanelCollapsed)) /
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

const PAN_SAFE_PADDING = 40;

/**
 * Compute a clamped horizontal viewport translation that centres an object
 * on the full screen, then shifts just enough so neither panel occludes it.
 *
 * @param objectX   – world-space left edge of the object
 * @param objectW   – world-space width of the object
 * @param scale     – current zoom scale
 * @param leftInset – screen-space left panel width (px)
 * @param rightInset – screen-space right panel width (px)
 */
export function clampCenterX(
  objectX: number,
  objectW: number,
  scale: number,
  leftInset: number,
  rightInset: number,
): number {
  const objectCenterWorld = objectX + objectW / 2;
  let cx = window.innerWidth / 2 - leftInset - objectCenterWorld * scale;

  // Visible canvas area: 0 … (window.innerWidth - leftInset - rightInset)

  // Left clamp: object left edge must stay PAN_SAFE_PADDING inside canvas
  const canvasLeft = cx + objectX * scale;
  if (canvasLeft < PAN_SAFE_PADDING) {
    cx += PAN_SAFE_PADDING - canvasLeft;
  }

  // Right clamp: object right edge must stay PAN_SAFE_PADDING from right panel
  const canvasRight = cx + (objectX + objectW) * scale;
  const visibleWidth = window.innerWidth - leftInset - rightInset;
  if (canvasRight > visibleWidth - PAN_SAFE_PADDING) {
    cx -= canvasRight - (visibleWidth - PAN_SAFE_PADDING);
  }

  return cx;
}
