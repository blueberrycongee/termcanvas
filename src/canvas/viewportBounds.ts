import type { Viewport } from "../types";
import { COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";

// The right panel hosts the code-navigation tabs (Files / Diff /
// Git / Memory). Canvas placement math needs to exclude its
// footprint so terminals don't spawn underneath it.
export function getCanvasRightInset(
  rightPanelCollapsed: boolean,
  rightPanelWidth: number,
) {
  return rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : rightPanelWidth;
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

export function screenDeltaToCanvasDelta(
  deltaX: number,
  deltaY: number,
  viewport: Viewport,
) {
  return {
    x: deltaX / viewport.scale,
    y: deltaY / viewport.scale,
  };
}

/**
 * Visible canvas area in world space. Accounts for left/right side panels
 * and the top toolbar so callers that want to place new content "inside the
 * visible viewport" don't end up putting it under a panel or the toolbar.
 */
const CANVAS_TOP_INSET = 56;

export function getVisibleCanvasWorldRect(
  viewport: Viewport,
  rightPanelCollapsed: boolean,
  leftPanelCollapsed: boolean,
  leftPanelWidth: number,
  rightPanelWidth: number,
): { x: number; y: number; w: number; h: number } {
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const rightInset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth);
  const screenW = Math.max(
    0,
    window.innerWidth - leftInset - rightInset,
  );
  const screenH = Math.max(0, window.innerHeight - CANVAS_TOP_INSET);
  const x = -viewport.x / viewport.scale;
  const y = (-viewport.y + CANVAS_TOP_INSET) / viewport.scale;
  return {
    x,
    y,
    w: screenW / viewport.scale,
    h: screenH / viewport.scale,
  };
}

export function rectIntersectsCanvasViewport(
  rect: { x: number; y: number; w: number; h: number },
  viewport: Viewport,
  rightPanelCollapsed: boolean,
  leftPanelCollapsed: boolean,
  leftPanelWidth: number,
  rightPanelWidth: number,
  margin = 120,
) {
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const left = -viewport.x / viewport.scale - margin;
  const top = -viewport.y / viewport.scale - margin;
  const right =
    left +
    (window.innerWidth -
      leftInset -
      getCanvasRightInset(rightPanelCollapsed, rightPanelWidth)) /
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
 * Compute a horizontal viewport translation that places the object at a
 * fixed distance from the left-panel edge, then clamps so neither panel
 * occludes it.
 *
 * The base term deliberately omits `leftInset`: the viewport translation
 * target should not react to left-panel width changes. This keeps the two
 * sidebar-toggle paths visually symmetric — a sidebar toggle only needs
 * to animate the panel's own width, not ALSO race a 400 ms viewport pan
 * against the 240 ms panel transition. The object naturally shifts with
 * the panel's inner edge because `leftInset` is still added when the
 * viewport is projected to screen coordinates (see `canvasPointToScreenPoint`).
 *
 * @param objectX   – world-space left edge of the object
 * @param objectW   – world-space width of the object
 * @param scale     – current zoom scale
 * @param leftInset – screen-space left panel width (px) — only used for clamping
 * @param rightInset – screen-space right panel width (px) — only used for clamping
 */
export function clampCenterX(
  objectX: number,
  objectW: number,
  scale: number,
  leftInset: number,
  rightInset: number,
): number {
  const objectCenterWorld = objectX + objectW / 2;
  let cx = window.innerWidth / 2 - objectCenterWorld * scale;

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
