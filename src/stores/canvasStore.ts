import { create } from "zustand";
import type { Viewport } from "../types";

interface CanvasStore {
  viewport: Viewport;
  isAnimating: boolean;
  sidebarCollapsed: boolean;
  setViewport: (viewport: Partial<Viewport>) => void;
  resetViewport: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  animateTo: (x: number, y: number, scale?: number) => void;
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };
const ANIM_DURATION = 400;

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  viewport: { ...DEFAULT_VIEWPORT },
  isAnimating: false,
  sidebarCollapsed: false,

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  setViewport: (partial) =>
    set((state) => ({
      viewport: { ...state.viewport, ...partial },
    })),

  resetViewport: () => set({ viewport: { ...DEFAULT_VIEWPORT } }),

  animateTo: (targetX, targetY, targetScale) => {
    const { viewport } = get();
    const startX = viewport.x;
    const startY = viewport.y;
    const startScale = viewport.scale;
    const endScale = targetScale ?? startScale;
    const startTime = performance.now();

    set({ isAnimating: true, sidebarCollapsed: true });

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / ANIM_DURATION);
      const t = easeOutCubic(progress);

      set({
        viewport: {
          x: startX + (targetX - startX) * t,
          y: startY + (targetY - startY) * t,
          scale: startScale + (endScale - startScale) * t,
        },
      });

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        set({ isAnimating: false });
      }
    };

    requestAnimationFrame(tick);
  },
}));
