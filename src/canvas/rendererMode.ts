export type CanvasRendererMode = "legacy" | "xyflow";

const STORAGE_KEY = "termcanvas-canvas-renderer";

export function getCanvasRendererMode(): CanvasRendererMode {
  if (typeof window === "undefined") {
    return "legacy";
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "xyflow" ? "xyflow" : "legacy";
}

export function isXyflowRendererEnabled() {
  return getCanvasRendererMode() === "xyflow";
}
