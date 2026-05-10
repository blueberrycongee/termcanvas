// Pet overlay surface adapter.
//
// PetOverlay drives an animation via `requestAnimationFrame`. Under macOS
// Space switching the RAF callback chain is paused, so the pet freezes
// mid-animation. The RAF callback that re-schedules itself eventually
// resumes once Chromium un-throttles, but a stuck WebGL pipeline or a
// renderer-side error can break the chain permanently.
//
// Registering the pet as a surface gives us:
//   1. A repaint entry point for visibility-change recovery — kicks the
//      RAF chain back into life if it had stalled.
//   2. A `lastPaintAt` health field the heartbeat watchdog can consume.
//
// The pet doesn't have a GPU-resource heavy surface (SVG) so the
// `severity = heavy` branch is the same as `light` — a single repaint
// kick is enough.

import type {
  RenderableSurface,
  SurfaceHealth,
} from "../../shared/render-surface";

export interface PetSurfaceDeps {
  // Schedule one tick of the pet's RAF chain. Implementation-specific.
  // Called from forceRepaint to nudge the loop back to life.
  triggerPaint: () => void;
  // Probe: is the pet currently considered visible / mounted?
  isMounted: () => boolean;
}

export interface PetSurfaceHandle {
  surface: RenderableSurface;
  markPaint(): void;
  dispose(): void;
}

const PET_SURFACE_ID = "pet-overlay";

export function createPetSurface(deps: PetSurfaceDeps): PetSurfaceHandle {
  let lastPaintAt: number | null = null;
  let visibleHint = true;

  const surface: RenderableSurface = {
    id: PET_SURFACE_ID,
    kind: "pet",
    setVisible(visible: boolean) {
      visibleHint = visible;
    },
    forceRepaint() {
      try {
        deps.triggerPaint();
      } catch {
        // Pet repaint is best-effort; an exception inside the loop's
        // tick callback is a real bug we don't want to mask, but we
        // also don't want to brick the recovery dispatch for other
        // surfaces.
      }
    },
    getHealth(): SurfaceHealth {
      return {
        visible: visibleHint && deps.isMounted(),
        lastPaintAt,
        contextLost: false,
        rendererMode: "dom",
      };
    },
  };

  return {
    surface,
    markPaint(): void {
      lastPaintAt = Date.now();
    },
    dispose(): void {
      // Nothing dynamic to clean up — the React component owns
      // unregistration via the registry's dispose fn.
    },
  };
}
