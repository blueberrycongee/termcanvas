import { create } from "zustand";
import type { Viewport } from "../types";
import { useWorkspaceStore } from "./workspaceStore";

export type FocusLevel = "terminal" | "starred" | "worktree";
export type LeftPanelTab = "files" | "diff" | "preview" | "git" | "memory";
export type RightPanelTab = "usage" | "sessions" | "hydra";
export interface CanvasViewportAdapter {
  setViewport: (viewport: Viewport, options?: { duration?: number }) => void;
  getViewport: () => Viewport;
}

export const RIGHT_PANEL_WIDTH = 240;
export const COLLAPSED_TAB_WIDTH = 32;

interface CanvasStore {
  viewport: Viewport;
  isAnimating: boolean;
  focusLevel: FocusLevel;
  rightPanelCollapsed: boolean;
  rightPanelActiveTab: RightPanelTab;
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
  leftPanelActiveTab: LeftPanelTab;
  leftPanelPreviewFile: string | null;
  registerViewportAdapter: (adapter: CanvasViewportAdapter | null) => void;
  restoreViewport: (viewport: Viewport) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  syncViewportFromRenderer: (viewport: Viewport) => void;
  commitViewportFromRenderer: (viewport: Viewport) => void;
  resetViewport: () => void;
  setFocusLevel: (level: FocusLevel) => void;
  cycleFocusLevel: () => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelActiveTab: (tab: RightPanelTab) => void;
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setLeftPanelWidth: (width: number) => void;
  setLeftPanelActiveTab: (tab: LeftPanelTab) => void;
  setLeftPanelPreviewFile: (filePath: string | null) => void;
  animateTo: (x: number, y: number, scale?: number) => void;
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };
const ANIM_DURATION = 400;

let animationId = 0;
let activeViewportAdapter: CanvasViewportAdapter | null = null;
let animationResetTimer: ReturnType<typeof setTimeout> | null = null;

function markDirty() {
  useWorkspaceStore.getState().markDirty();
}

function clearAnimationResetTimer() {
  if (animationResetTimer) {
    clearTimeout(animationResetTimer);
    animationResetTimer = null;
  }
}

function viewportEquals(a: Viewport, b: Viewport) {
  return (
    Math.abs(a.x - b.x) < 0.001 &&
    Math.abs(a.y - b.y) < 0.001 &&
    Math.abs(a.scale - b.scale) < 0.0001
  );
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  viewport: { ...DEFAULT_VIEWPORT },
  isAnimating: false,
  focusLevel: "terminal" as FocusLevel,
  rightPanelCollapsed: true,
  rightPanelActiveTab: "sessions" as RightPanelTab,
  leftPanelCollapsed: true,
  leftPanelWidth: 280,
  leftPanelActiveTab: "files" as LeftPanelTab,
  leftPanelPreviewFile: null,

  registerViewportAdapter: (adapter) => {
    activeViewportAdapter = adapter;
    clearAnimationResetTimer();

    if (!adapter) {
      set({ isAnimating: false });
      return;
    }

    adapter.setViewport(get().viewport);
  },

  restoreViewport: (viewport) => {
    clearAnimationResetTimer();
    set({ viewport, isAnimating: false });
    activeViewportAdapter?.setViewport(viewport);
  },

  setFocusLevel: (level) => set({ focusLevel: level }),
  cycleFocusLevel: () => {
    const order: FocusLevel[] = ["terminal", "starred", "worktree"];
    const current = get().focusLevel;
    const next = order[(order.indexOf(current) + 1) % order.length];
    set({ focusLevel: next });
  },
  setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),
  setRightPanelActiveTab: (tab) => set({ rightPanelActiveTab: tab }),
  setLeftPanelCollapsed: (collapsed) => {
    set({ leftPanelCollapsed: collapsed });
    markDirty();
  },
  setLeftPanelWidth: (width) => {
    set({ leftPanelWidth: width });
    markDirty();
  },
  setLeftPanelActiveTab: (tab) => {
    set({ leftPanelActiveTab: tab });
    markDirty();
  },
  setLeftPanelPreviewFile: (filePath) => set({ leftPanelPreviewFile: filePath }),

  setViewport: (partial) => {
    const nextViewport = { ...get().viewport, ...partial };
    if (viewportEquals(nextViewport, get().viewport)) {
      return;
    }

    set({ viewport: nextViewport });
    activeViewportAdapter?.setViewport(nextViewport);
    markDirty();
  },

  syncViewportFromRenderer: (viewport) => {
    if (viewportEquals(viewport, get().viewport)) {
      return;
    }

    set({ viewport });
  },

  commitViewportFromRenderer: (viewport) => {
    clearAnimationResetTimer();
    if (viewportEquals(viewport, get().viewport)) {
      set({ isAnimating: false });
      markDirty();
      return;
    }

    set({ viewport, isAnimating: false });
    markDirty();
  },

  resetViewport: () => {
    const nextViewport = { ...DEFAULT_VIEWPORT };
    clearAnimationResetTimer();
    set({ viewport: nextViewport, isAnimating: false });
    activeViewportAdapter?.setViewport(nextViewport);
    markDirty();
  },

  animateTo: (targetX, targetY, targetScale) => {
    const { viewport } = get();
    const startX = viewport.x;
    const startY = viewport.y;
    const startScale = viewport.scale;
    const endScale = targetScale ?? startScale;

    if (
      Math.abs(startX - targetX) < 1 &&
      Math.abs(startY - targetY) < 1 &&
      Math.abs(startScale - endScale) < 0.001
    ) {
      return;
    }

    if (activeViewportAdapter) {
      const nextViewport = {
        x: targetX,
        y: targetY,
        scale: endScale,
      };

      clearAnimationResetTimer();
      set({ isAnimating: true });
      activeViewportAdapter.setViewport(nextViewport, {
        duration: ANIM_DURATION,
      });
      animationResetTimer = setTimeout(() => {
        set({ isAnimating: false });
        animationResetTimer = null;
      }, ANIM_DURATION);
      markDirty();
      return;
    }

    const startTime = performance.now();
    const myId = ++animationId;

    set({ isAnimating: true });

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
