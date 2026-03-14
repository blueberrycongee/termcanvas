import { create } from "zustand";
import type { Viewport } from "../types";

interface CanvasStore {
  viewport: Viewport;
  setViewport: (viewport: Partial<Viewport>) => void;
  resetViewport: () => void;
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };

export const useCanvasStore = create<CanvasStore>((set) => ({
  viewport: { ...DEFAULT_VIEWPORT },

  setViewport: (partial) =>
    set((state) => ({
      viewport: { ...state.viewport, ...partial },
    })),

  resetViewport: () => set({ viewport: { ...DEFAULT_VIEWPORT } }),
}));
