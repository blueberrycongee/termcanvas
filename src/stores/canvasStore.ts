import { create } from "zustand";
import type { Viewport } from "../types";
import { useWorkspaceStore } from "./workspaceStore";

// Fixed panel dimensions (no user-resizable widths)
export const SIDEBAR_WIDTH = 200;
export const RIGHT_PANEL_WIDTH = 240;
export const COLLAPSED_TAB_WIDTH = 32;

interface CanvasStore {
  viewport: Viewport;
  isAnimating: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  setViewport: (viewport: Partial<Viewport>) => void;
  resetViewport: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  animateTo: (x: number, y: number, scale?: number) => void;
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };
const ANIM_DURATION = 400;

let animationId = 0;

function markDirty() {
  useWorkspaceStore.getState().markDirty();
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  viewport: { ...DEFAULT_VIEWPORT },
  isAnimating: false,
  sidebarCollapsed: false,
  rightPanelCollapsed: true,

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),

  setViewport: (partial) => {
    set((state) => ({
      viewport: { ...state.viewport, ...partial },
    }));
    markDirty();
  },

  resetViewport: () => set({ viewport: { ...DEFAULT_VIEWPORT } }),

  animateTo: (targetX, targetY, targetScale) => {
    const { viewport } = get();
    const startX = viewport.x;
    const startY = viewport.y;
    const startScale = viewport.scale;
    const endScale = targetScale ?? startScale;

    // Skip animation if already at target
    if (
      Math.abs(startX - targetX) < 1 &&
      Math.abs(startY - targetY) < 1 &&
      Math.abs(startScale - endScale) < 0.001
    ) {
      return;
    }

    const startTime = performance.now();
    const myId = ++animationId;

    set({ isAnimating: true, sidebarCollapsed: true });

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      if (myId !== animationId) return; // superseded by a newer animation

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
