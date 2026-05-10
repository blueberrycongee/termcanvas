// Monaco editor surface adapter.
//
// Monaco owns its own renderer. We can't observe paints, but we can
// trigger them: `editor.render(true)` forces a synchronous re-render of
// every visible decoration, and `editor.layout()` re-measures the
// container in case it changed size while the page was occluded.
//
// Why register at all if we can't track stalls: the recovery dispatch
// triggered by visibility change / lifecycle resume / IPC still flows
// through the registry. Without registration, Monaco wouldn't be told
// about the visibility transition — and after a long Space switch we've
// observed the editor cursor halting until the user clicks. Calling
// `render(true) + layout()` on recovery cleans that up reliably.

import type {
  RenderableSurface,
  SurfaceHealth,
} from "../../shared/render-surface";

// Narrow Monaco editor shape — keeps this file decoupled from the
// monaco-editor types so it can be mocked freely in tests and so we
// don't widen the bundle by importing monaco-editor here.
export interface MonacoEditorLike {
  render(forceRedraw?: boolean): void;
  layout(): void;
}

export interface MonacoSurfaceDeps {
  editor: MonacoEditorLike;
  // Monaco is mounted via a lazy React component. Call site must hand
  // us a probe so getHealth.visible reflects the actual drawer state.
  isMounted: () => boolean;
}

export interface MonacoSurfaceHandle {
  surface: RenderableSurface;
  dispose(): void;
}

const MONACO_SURFACE_ID = "monaco-editor";

export function createMonacoSurface(
  deps: MonacoSurfaceDeps,
): MonacoSurfaceHandle {
  let visibleHint = true;

  const surface: RenderableSurface = {
    id: MONACO_SURFACE_ID,
    kind: "monaco",
    setVisible(visible: boolean) {
      visibleHint = visible;
    },
    forceRepaint() {
      try {
        deps.editor.render(true);
        deps.editor.layout();
      } catch {
        // Monaco render/layout occasionally throws if the editor is in
        // mid-disposal; recovery should fail-soft per the registry's
        // error-isolation contract.
      }
    },
    getHealth(): SurfaceHealth {
      // We don't observe Monaco paints, so the heartbeat watchdog
      // can't meaningfully detect a stall here. Reporting `lastPaintAt =
      // Date.now()` tells the watchdog "this surface is fine, move on";
      // the surface still benefits from external recovery triggers.
      return {
        visible: visibleHint && deps.isMounted(),
        lastPaintAt: Date.now(),
        contextLost: false,
        rendererMode: "canvas",
      };
    },
  };

  return {
    surface,
    dispose(): void {
      // No subscriptions to tear down. The owning React component
      // handles unregistration via the registry's dispose return.
    },
  };
}
