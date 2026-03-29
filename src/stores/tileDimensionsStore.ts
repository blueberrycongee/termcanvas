import { create } from "zustand";
import { useCanvasStore } from "./canvasStore";
import { getCanvasLeftInset, getCanvasRightInset } from "../canvas/viewportBounds";

const TARGET_AREA = 640 * 480; // 307200
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

interface TileDimensionsStore {
  w: number;
  h: number;
  recalculate: () => void;
}

export const useTileDimensionsStore = create<TileDimensionsStore>((set) => ({
  w: 640,
  h: 480,
  recalculate: () => {
    const { leftPanelCollapsed, leftPanelWidth, rightPanelCollapsed } =
      useCanvasStore.getState();
    const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
    const rightOffset = getCanvasRightInset(rightPanelCollapsed);
    const dims = computeTileDimensions(
      window.innerWidth,
      window.innerHeight,
      leftOffset,
      rightOffset,
    );
    set(dims);
  },
}));
