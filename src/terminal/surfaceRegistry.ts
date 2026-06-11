// Renderer-process registry of every `RenderableSurface` that wants to
// participate in render recovery (and, in PR 5, the paint heartbeat
// watchdog).
//
// Surfaces register on mount, unregister on unmount. The recovery
// listener in `terminalRuntimeStore.installRenderRecoveryListeners` calls
// `dispatchSurfaceRecovery` instead of walking the terminal-only
// runtimeRegistry — that lets non-terminal GPU surfaces (Monaco, the
// canvas graph layer, the Pet) get the same recovery treatment without
// terminalRuntimeStore needing to know about them.

import type {
  RenderableSurface,
  SurfaceDispatchResult,
  SurfaceHealth,
  SurfaceKind,
  SurfaceRecoverySeverity,
} from "../../shared/render-surface";
import { recordRenderDiagnostic } from "./renderDiagnostics";

const surfaces = new Map<string, RenderableSurface>();

export function registerSurface(surface: RenderableSurface): () => void {
  if (surfaces.has(surface.id)) {
    // A double-register usually indicates a forgotten unregister on the
    // previous mount. Replace silently — keeping the new surface — and
    // record so the divergence is visible in diagnostics.
    recordRenderDiagnostic({
      kind: "surface_register_replaced",
      data: { surface_id: surface.id, surface_kind: surface.kind },
    });
  }
  surfaces.set(surface.id, surface);
  recordRenderDiagnostic({
    kind: "surface_register",
    data: {
      surface_id: surface.id,
      surface_kind: surface.kind,
      registry_size: surfaces.size,
    },
  });
  return () => unregisterSurface(surface.id);
}

export function unregisterSurface(id: string): void {
  if (!surfaces.delete(id)) return;
  recordRenderDiagnostic({
    kind: "surface_unregister",
    data: { surface_id: id, registry_size: surfaces.size },
  });
}

export function getSurface(id: string): RenderableSurface | null {
  return surfaces.get(id) ?? null;
}

export function listSurfaces(): RenderableSurface[] {
  return [...surfaces.values()];
}

export function listSurfacesByKind(kind: SurfaceKind): RenderableSurface[] {
  const out: RenderableSurface[] = [];
  for (const surface of surfaces.values()) {
    if (surface.kind === kind) out.push(surface);
  }
  return out;
}

export function getSurfaceHealth(id: string): SurfaceHealth | null {
  const surface = surfaces.get(id);
  if (!surface) return null;
  try {
    return surface.getHealth();
  } catch {
    return null;
  }
}

// Recovery entry point for `VisibilityObserver.onRecovery`. Walks every
// registered surface, calls `forceRepaint`, and tallies result counters.
// Surface-level errors are caught so one bad surface can't block recovery
// for the rest.
export function dispatchSurfaceRecovery(
  reason: string,
  severity: SurfaceRecoverySeverity,
): SurfaceDispatchResult {
  let refreshed = 0;
  let errors = 0;
  const total = surfaces.size;

  for (const surface of surfaces.values()) {
    try {
      surface.forceRepaint(reason, severity);
      refreshed += 1;
    } catch (error) {
      errors += 1;
      recordRenderDiagnostic({
        kind: "surface_force_repaint_failed",
        data: {
          surface_id: surface.id,
          surface_kind: surface.kind,
          reason,
          severity,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  recordRenderDiagnostic({
    kind: "surface_recovery_dispatched",
    data: { reason, severity, total, refreshed, errors },
  });

  return { total, refreshed, errors };
}

// Test-only: clear the registry between cases.
export function __resetSurfaceRegistryForTesting(): void {
  surfaces.clear();
}
