// Main canvas (xyflow graph) surface adapter.
//
// xyflow owns its own paint loop and handles re-render via React state
// changes. forceRepaint nudges that loop by writing the current viewport
// back through the canvasStore — a no-op in value but a non-no-op in
// state-update terms, which causes xyflow to re-evaluate and repaint.
// (We can't call into the xyflow renderer directly without keeping a
// reactflow instance ref around module-globally; the store-write path is
// already the canonical way to invalidate.)

import type {
  RenderableSurface,
  SurfaceHealth,
} from "../../shared/render-surface";

export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasSurfaceDeps {
  // Read-back of the live viewport. Implementations typically wrap
  // `useCanvasStore.getState().viewport` or `getViewport()`.
  getViewport: () => CanvasViewport | null;
  // Write-back. Setting a no-op viewport (same value) still bumps
  // xyflow's render dependency.
  setViewport: (viewport: CanvasViewport) => void;
  // Document-level visibility probe.
  isVisible: () => boolean;
}

export interface CanvasSurfaceHandle {
  surface: RenderableSurface;
  dispose(): void;
}

const CANVAS_SURFACE_ID = "main-canvas";

export function createCanvasSurface(
  deps: CanvasSurfaceDeps,
): CanvasSurfaceHandle {
  const surface: RenderableSurface = {
    id: CANVAS_SURFACE_ID,
    kind: "canvas",
    setVisible() {
      // No-op: the canvas is gated by document visibility, not a
      // per-component flag.
    },
    forceRepaint() {
      const v = deps.getViewport();
      if (!v) return;
      try {
        // Re-write the same viewport. xyflow re-evaluates because
        // identity changed; the user-visible coordinates do not.
        deps.setViewport({ x: v.x, y: v.y, scale: v.scale });
      } catch {
        // best-effort
      }
    },
    getHealth(): SurfaceHealth {
      return {
        visible: deps.isVisible(),
        // xyflow doesn't expose a paint-tick we can observe. Mark as
        // current so the heartbeat watchdog doesn't false-fire on us
        // — the canvas still benefits from external recovery (visibility
        // change / lifecycle resume) which routes through forceRepaint.
        lastPaintAt: Date.now(),
        contextLost: false,
        rendererMode: "canvas",
      };
    },
  };

  return {
    surface,
    dispose(): void {
      // No subscriptions; React owner unregisters via the registry's
      // dispose fn.
    },
  };
}
