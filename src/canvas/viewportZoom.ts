import type { Viewport } from "../types";
import {
  getCanvasLeftInset,
  getCanvasRightInset,
  screenPointToCanvasPoint,
} from "./viewportBounds";

export const MIN_CANVAS_SCALE = 0.1;
export const MAX_CANVAS_SCALE = 2;
export const CANVAS_ZOOM_STEPS = [
  0.1,
  0.15,
  0.2,
  0.25,
  0.33,
  0.5,
  0.67,
  0.8,
  1,
  1.25,
  1.5,
  2,
] as const;

const ZOOM_EPSILON = 0.0001;

export function clampScale(scale: number): number {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

export function getNextZoomStep(
  currentScale: number,
  direction: "in" | "out",
): number {
  const clamped = clampScale(currentScale);

  if (direction === "in") {
    return (
      CANVAS_ZOOM_STEPS.find((step) => step > clamped + ZOOM_EPSILON) ??
      MAX_CANVAS_SCALE
    );
  }

  for (let index = CANVAS_ZOOM_STEPS.length - 1; index >= 0; index -= 1) {
    const step = CANVAS_ZOOM_STEPS[index];
    if (step < clamped - ZOOM_EPSILON) {
      return step;
    }
  }

  return MIN_CANVAS_SCALE;
}

export function zoomAtClientPoint({
  clientX,
  clientY,
  leftPanelCollapsed,
  leftPanelWidth,
  nextScale,
  viewport,
}: {
  clientX: number;
  clientY: number;
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
  nextScale: number;
  viewport: Viewport;
}): Viewport {
  const scale = clampScale(nextScale);
  const worldPoint = screenPointToCanvasPoint(
    clientX,
    clientY,
    viewport,
    leftPanelCollapsed,
    leftPanelWidth,
  );
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);

  return {
    x: clientX - leftInset - worldPoint.x * scale,
    y: clientY - worldPoint.y * scale,
    scale,
  };
}

export function getViewportCenterClientPoint({
  leftPanelCollapsed,
  leftPanelWidth,
  rightPanelCollapsed,
  rightPanelWidth,
  topInset = 0,
}: {
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
  rightPanelCollapsed: boolean;
  rightPanelWidth: number;
  topInset?: number;
}) {
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const rightInset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth);
  const visibleWidth = window.innerWidth - leftInset - rightInset;
  const visibleHeight = window.innerHeight - topInset;

  return {
    x: leftInset + visibleWidth / 2,
    y: topInset + visibleHeight / 2,
  };
}
