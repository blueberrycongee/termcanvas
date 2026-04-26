import { create } from "zustand";
import type { Viewport } from "../types";
import { useWorkspaceStore } from "./workspaceStore";

export type FocusLevel = "terminal" | "starred" | "worktree";
/**
 * Tabs shown in the RIGHT panel — the code-navigation surface
 * (Files / Diff / Git / Memory). Previously these lived in the LEFT
 * panel under `LeftPanelTab`; they moved to the right when the left
 * panel became the project-management surface.
 *
 * "preview" used to be a fallback tab that took over when the user
 * clicked a file. That tab is gone — file previews/edits happen in
 * the FileEditor drawer (Monaco) that slides over the canvas,
 * driven by `fileEditorPath` below.
 */
export type RightPanelTab = "files" | "diff" | "git" | "memory";
/** @deprecated kept as alias — LeftPanelTab is the same set under its new home. */
export type LeftPanelTab = RightPanelTab;
export interface CanvasViewportAdapter {
  setViewport: (viewport: Viewport, options?: { duration?: number }) => void;
  getViewport: () => Viewport;
}

// Default right-panel width when the user hasn't customised it.
// Previously a hard-coded 240 px that was used directly everywhere. It
// still exists as `RIGHT_PANEL_WIDTH` (aliased below) for a handful of
// external/legacy imports, but UI code should read the dynamic
// `rightPanelWidth` from the store so drag-resize works.
export const DEFAULT_RIGHT_PANEL_WIDTH = 360;
export const RIGHT_PANEL_WIDTH = DEFAULT_RIGHT_PANEL_WIDTH;
export const COLLAPSED_TAB_WIDTH = 32;
// TaskDrawer slides out from the LeftPanel's right edge. When open,
// every consumer of "left chrome width" (canvas tile placement, screen↔
// canvas conversions, layered drawers) treats it as part of the left
// inset so terminals reflow instead of getting occluded.
export const TASK_DRAWER_WIDTH = 320;

interface CanvasStore {
  viewport: Viewport;
  isAnimating: boolean;
  focusLevel: FocusLevel;
  rightPanelCollapsed: boolean;
  rightPanelActiveTab: RightPanelTab;
  rightPanelWidth: number;
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
  /**
   * File path currently open in the full-canvas Monaco drawer.
   * `null` means the drawer is closed. Persisted only in-memory —
   * closing the app drops the "last open file" state.
   */
  fileEditorPath: string | null;
  /**
   * Two-level drawer: level-1 (false) covers the right panel + half
   * the canvas so terminals stay partially visible; level-2 (true)
   * covers the entire canvas area (still leaves the left panel).
   */
  fileEditorExpanded: boolean;
  // Usage, Sessions, and the File Editor all share the canvas-gap
  // area between the left and right side panels; at most one is
  // visible at a time (mutual exclusion enforced in their setters).
  // Each carries an `expanded` flag for two-level (half vs full)
  // geometry — except Usage which is single-level.
  usageOverlayOpen: boolean;
  sessionsOverlayOpen: boolean;
  sessionsOverlayExpanded: boolean;
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
  setRightPanelWidth: (width: number) => void;
  openFileEditor: (filePath: string) => void;
  closeFileEditor: () => void;
  toggleFileEditorExpanded: () => void;
  setFileEditorExpanded: (expanded: boolean) => void;
  openUsageOverlay: () => void;
  closeUsageOverlay: () => void;
  toggleUsageOverlay: () => void;
  openSessionsOverlay: () => void;
  closeSessionsOverlay: () => void;
  toggleSessionsOverlay: () => void;
  toggleSessionsOverlayExpanded: () => void;
  setSessionsOverlayExpanded: (expanded: boolean) => void;
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setLeftPanelWidth: (width: number) => void;
  animateTo: (
    x: number,
    y: number,
    scale?: number,
    opts?: { duration?: number; easing?: (t: number) => number },
  ) => void;
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
  rightPanelActiveTab: "files" as RightPanelTab,
  rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
  leftPanelCollapsed: true,
  leftPanelWidth: 280,
  fileEditorPath: null,
  fileEditorExpanded: true,
  usageOverlayOpen: false,
  sessionsOverlayOpen: false,
  sessionsOverlayExpanded: true,

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
  setRightPanelCollapsed: (collapsed) => {
    set({ rightPanelCollapsed: collapsed });
    markDirty();
  },
  setRightPanelActiveTab: (tab) => {
    set({ rightPanelActiveTab: tab });
    markDirty();
  },
  setRightPanelWidth: (width) => {
    set({ rightPanelWidth: width });
    markDirty();
  },
  // File editor, Usage, and Sessions replay all share the canvas-gap
  // area between the left and right panels. At most one is visible
  // at a time — opening one evicts the others so they never fight
  // for the same pixels.
  openFileEditor: (filePath) =>
    set({
      fileEditorPath: filePath,
      fileEditorExpanded: true,
      usageOverlayOpen: false,
      sessionsOverlayOpen: false,
      sessionsOverlayExpanded: false,
    }),
  closeFileEditor: () =>
    set({ fileEditorPath: null, fileEditorExpanded: false }),
  toggleFileEditorExpanded: () =>
    set((state) => ({ fileEditorExpanded: !state.fileEditorExpanded })),
  setFileEditorExpanded: (expanded) => set({ fileEditorExpanded: expanded }),
  openUsageOverlay: () =>
    set({
      usageOverlayOpen: true,
      fileEditorPath: null,
      fileEditorExpanded: false,
      sessionsOverlayOpen: false,
      sessionsOverlayExpanded: false,
    }),
  closeUsageOverlay: () => set({ usageOverlayOpen: false }),
  toggleUsageOverlay: () =>
    set((state) => {
      const nextOpen = !state.usageOverlayOpen;
      if (!nextOpen) return { usageOverlayOpen: false };
      return {
        usageOverlayOpen: true,
        fileEditorPath: null,
        fileEditorExpanded: false,
        sessionsOverlayOpen: false,
        sessionsOverlayExpanded: false,
      };
    }),
  openSessionsOverlay: () =>
    set({
      sessionsOverlayOpen: true,
      sessionsOverlayExpanded: true,
      fileEditorPath: null,
      fileEditorExpanded: false,
      usageOverlayOpen: false,
    }),
  closeSessionsOverlay: () =>
    set({ sessionsOverlayOpen: false, sessionsOverlayExpanded: false }),
  toggleSessionsOverlay: () =>
    set((state) => {
      const nextOpen = !state.sessionsOverlayOpen;
      if (!nextOpen) {
        return { sessionsOverlayOpen: false, sessionsOverlayExpanded: false };
      }
      return {
        sessionsOverlayOpen: true,
        sessionsOverlayExpanded: true,
        fileEditorPath: null,
        fileEditorExpanded: false,
        usageOverlayOpen: false,
      };
    }),
  toggleSessionsOverlayExpanded: () =>
    set((state) => ({
      sessionsOverlayExpanded: !state.sessionsOverlayExpanded,
    })),
  setSessionsOverlayExpanded: (expanded) =>
    set({ sessionsOverlayExpanded: expanded }),
  setLeftPanelCollapsed: (collapsed) => {
    set({ leftPanelCollapsed: collapsed });
    markDirty();
  },
  setLeftPanelWidth: (width) => {
    set({ leftPanelWidth: width });
    markDirty();
  },

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

  animateTo: (targetX, targetY, targetScale, opts) => {
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

    clearAnimationResetTimer();
    const startTime = performance.now();
    const myId = ++animationId;

    set({ isAnimating: true });

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const duration = opts?.duration ?? ANIM_DURATION;
    const easing = opts?.easing ?? easeOutCubic;

    const tick = (now: number) => {
      if (myId !== animationId) return; // superseded by a newer animation

      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const t = easing(progress);

      const nextViewport = {
        x: startX + (targetX - startX) * t,
        y: startY + (targetY - startY) * t,
        scale: startScale + (endScale - startScale) * t,
      };

      set({ viewport: nextViewport });
      activeViewportAdapter?.setViewport(nextViewport);

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        set({ isAnimating: false });
      }
    };

    requestAnimationFrame(tick);
    markDirty();
  },
}));
