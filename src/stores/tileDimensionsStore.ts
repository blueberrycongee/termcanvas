import { create } from "zustand";
import { useCanvasStore } from "./canvasStore";
import { usePinStore } from "./pinStore";
import { getCanvasLeftInset, getCanvasRightInset } from "../canvas/viewportBounds";

const TARGET_AREA = 640 * 480;
const MIN_W = 400;
const MAX_W = 900;
const MIN_H = 300;
const MAX_H = 700;

export function computeTileDimensions(
  windowWidth: number,
  windowHeight: number,
  leftOffset: number,
  rightOffset: number,
): { w: number; h: number } {
  const availableW = Math.max(windowWidth - leftOffset - rightOffset, 200);
  const availableH = Math.max(windowHeight, 200);
  const ratio = availableW / availableH;

  let h = Math.sqrt(TARGET_AREA / ratio);
  let w = TARGET_AREA / h;

  w = Math.max(MIN_W, Math.min(MAX_W, w));
  h = Math.max(MIN_H, Math.min(MAX_H, TARGET_AREA / w));

  return { w: Math.round(w), h: Math.round(h) };
}

interface TileDimensionsState {
  w: number;
  h: number;
}

export const useTileDimensionsStore = create<TileDimensionsState>(() => ({
  w: 640,
  h: 480,
}));

export function recomputeTileDimensions() {
  const {
    leftPanelCollapsed,
    leftPanelWidth,
    rightPanelCollapsed,
    rightPanelWidth,
  } = useCanvasStore.getState();
  const leftOffset = getCanvasLeftInset(
    leftPanelCollapsed,
    leftPanelWidth,
    usePinStore.getState().openProjectPath !== null,
  );
  const rightOffset = getCanvasRightInset(rightPanelCollapsed, rightPanelWidth);
  const dims = computeTileDimensions(
    window.innerWidth,
    window.innerHeight,
    leftOffset,
    rightOffset,
  );
  const prev = useTileDimensionsStore.getState();
  if (prev.w !== dims.w || prev.h !== dims.h) {
    useTileDimensionsStore.setState(dims);
  }
}

let trackSidebar = false;

export function setTrackSidebar(active: boolean) {
  trackSidebar = active;
  if (active) recomputeTileDimensions();
}

useCanvasStore.subscribe((state, prev) => {
  if (!trackSidebar) return;
  if (
    state.leftPanelCollapsed !== prev.leftPanelCollapsed ||
    state.leftPanelWidth !== prev.leftPanelWidth ||
    state.rightPanelCollapsed !== prev.rightPanelCollapsed ||
    state.rightPanelWidth !== prev.rightPanelWidth
  ) {
    recomputeTileDimensions();
  }
});

usePinStore.subscribe((state, prev) => {
  if (!trackSidebar) return;
  if (
    (state.openProjectPath !== null) !==
    (prev.openProjectPath !== null)
  ) {
    recomputeTileDimensions();
  }
});

if (typeof window !== "undefined") {
  window.addEventListener("resize", recomputeTileDimensions);
  recomputeTileDimensions();
}
