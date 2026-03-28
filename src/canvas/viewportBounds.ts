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
  // Step 1 — ideal: centre on full screen width
  const objectCenterWorld = objectX + objectW / 2;
  let cx = -objectCenterWorld * scale + window.innerWidth / 2;

  // Step 2 — left clamp
  const screenLeft = cx + objectX * scale;
  const safeLeft = leftInset + PAN_SAFE_PADDING;
  if (screenLeft < safeLeft) {
    cx += safeLeft - screenLeft;
  }

  // Step 3 — right clamp
  const screenRight = cx + (objectX + objectW) * scale;
  const safeRight = window.innerWidth - rightInset - PAN_SAFE_PADDING;
  if (screenRight > safeRight) {
    cx -= screenRight - safeRight;
  }

  return cx;
}
