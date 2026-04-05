export type CanvasRendererMode = "legacy" | "xyflow";

const STORAGE_KEY = "termcanvas-canvas-renderer";
export const TARGET_CANVAS_RENDERER: CanvasRendererMode = "xyflow";
export const DEFAULT_CANVAS_RENDERER: CanvasRendererMode = "xyflow";

export function getTargetCanvasRendererMode(): CanvasRendererMode {
  return TARGET_CANVAS_RENDERER;
}

export function isCanvasRendererFrozen(mode: CanvasRendererMode) {
  return mode !== TARGET_CANVAS_RENDERER;
}

export function getCanvasRendererMode(): CanvasRendererMode {
  if (typeof window === "undefined") {
    return DEFAULT_CANVAS_RENDERER;
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "legacy" || saved === "xyflow"
    ? saved
    : DEFAULT_CANVAS_RENDERER;
}

export function isXyflowRendererEnabled() {
  return getCanvasRendererMode() === "xyflow";
}
