// Generic mount-time lifecycle hook for non-terminal surfaces.
//
// Each non-terminal surface (Pet, Monaco, main canvas) constructs its
// surface adapter inside a `useEffect`, registers it, and unregisters
// on unmount. The pattern is mechanical enough to share.
//
// `factory` is called once per mount; the returned object must expose
// `surface` (the RenderableSurface to register) and an optional
// `dispose` (called after unregistration). If `factory` returns null
// the registration is skipped — useful when the underlying object
// (e.g. monaco editor instance) isn't ready yet.

import { useEffect } from "react";
import type { RenderableSurface } from "../../shared/render-surface";
import {
  registerSurface,
  unregisterSurface,
} from "../terminal/surfaceRegistry";

export interface SurfaceMountResult {
  surface: RenderableSurface;
  dispose?: () => void;
}

export function useRenderableSurface(
  factory: () => SurfaceMountResult | null,
  deps: ReadonlyArray<unknown>,
): void {
  useEffect(() => {
    const result = factory();
    if (!result) return;
    registerSurface(result.surface);
    return () => {
      unregisterSurface(result.surface.id);
      result.dispose?.();
    };
    // The caller owns the dependency contract — they're saying "build
    // a new surface when these change".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
