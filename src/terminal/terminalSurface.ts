// Per-terminal `RenderableSurface` adapter.
//
// Wraps a `ManagedTerminalRuntime` so the surface registry can drive
// recovery (and, in PR 5, the paint heartbeat watchdog) without having
// to know anything about xterm internals. Each runtime owns exactly one
// surface across its lifetime: attached on `startTerminalRuntime`,
// detached on `destroyTerminalRuntime`.

import type {
  RenderableSurface,
  SurfaceHealth,
  SurfaceRecoverySeverity,
  SurfaceRendererMode,
} from "../../shared/render-surface";
import { recordRenderDiagnostic } from "./renderDiagnostics";
import { resetWebGL } from "./webglContextPool";

export interface TerminalSurfaceRuntimeView {
  readonly id: string;
  // True when the xterm instance is mounted and the runtime hasn't been
  // disposed. Used as the floor of `health.visible`.
  isLive(): boolean;
  // Whether the runtime currently has an attached container — i.e. is
  // expected to be painting in the live tile (vs parked offscreen).
  isAttached(): boolean;
  rendererMode(): SurfaceRendererMode;
  // Force xterm to repaint. Returns false if the runtime is mid-disposal.
  refreshXterm(): boolean;
  // Subscribe to xterm's onRender event, used for paint heartbeat. Must
  // return a dispose fn. Implementations may return a no-op disposer if
  // the underlying xterm hasn't been constructed yet.
  onPaint(callback: () => void): () => void;
}

export interface TerminalSurfaceHandle {
  surface: RenderableSurface;
  setVisibleHint(visible: boolean): void;
  markContextLost(): void;
  dispose(): void;
}

export function createTerminalSurface(
  view: TerminalSurfaceRuntimeView,
): TerminalSurfaceHandle {
  let visibleHint = true;
  let lastPaintAt: number | null = null;
  let contextLost = false;

  const paintDispose = view.onPaint(() => {
    lastPaintAt = Date.now();
    if (contextLost) {
      // A successful paint after a context-loss event proves the surface
      // recovered. Clear the flag so health stops reporting stale loss.
      contextLost = false;
    }
  });

  const surface: RenderableSurface = {
    id: view.id,
    kind: "terminal",
    setVisible(visible: boolean): void {
      if (visibleHint === visible) return;
      visibleHint = visible;
      recordRenderDiagnostic({
        kind: "terminal_surface_visibility",
        terminalId: view.id,
        data: { visible },
      });
    },
    forceRepaint(reason: string, severity: SurfaceRecoverySeverity): void {
      const refreshed = view.refreshXterm();
      recordRenderDiagnostic({
        kind: "terminal_surface_force_repaint",
        terminalId: view.id,
        data: { reason, severity, refreshed },
      });
      if (severity === "heavy") {
        // The framebuffer was almost certainly lost (visibility transition,
        // sleep/wake). Cycling the WebGL addon mirrors the previous
        // recovery path and rebuilds the texture atlas.
        resetWebGL(view.id, reason);
      }
    },
    getHealth(): SurfaceHealth {
      return {
        visible: visibleHint && view.isLive() && view.isAttached(),
        lastPaintAt,
        contextLost,
        rendererMode: view.rendererMode(),
      };
    },
  };

  return {
    surface,
    setVisibleHint(visible: boolean): void {
      surface.setVisible(visible);
    },
    markContextLost(): void {
      contextLost = true;
    },
    dispose(): void {
      try {
        paintDispose();
      } catch {
        // best-effort
      }
    },
  };
}
