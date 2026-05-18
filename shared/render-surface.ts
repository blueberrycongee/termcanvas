// Render-surface contract.
//
// A "surface" is anything on screen whose pixels are produced by GPU work
// that Chromium might pause when the page is occluded — terminals (xterm),
// the canvas-backed graph layer, code editors (Monaco), the Pet sprite,
// etc. PR 1 wired recovery only for terminals because that's where the
// macOS Space-switch bug surfaced first; PR 7 will register the rest.
//
// Why a registry instead of growing the recovery callback to know about
// every surface kind: each surface owns its own paint primitive and each
// kind's recovery is a slightly different ritual (xterm calls
// `refresh()`, Monaco calls `editor.render(true)`, raw canvas redraws its
// scene, etc.). A registry lets recovery dispatch stay a one-liner —
// `for surface in registry: surface.forceRepaint(...)` — while the
// per-surface implementation lives next to the surface itself.

export type SurfaceKind = "terminal" | "monaco" | "canvas" | "pet";

export type SurfaceRendererMode = "webgl" | "canvas" | "dom" | "unknown";

export type SurfaceRecoverySeverity = "light" | "heavy";

// Health snapshot returned by a surface for diagnostics + (in PR 5) the
// paint heartbeat watchdog. `lastPaintAt` is `Date.now()`-based; surfaces
// stamp it from inside their paint loop or `forceRepaint` callback.
export interface SurfaceHealth {
  // Whether this surface is currently considered visible by its owner.
  // For terminals: focused or recently touched.
  visible: boolean;
  // Last paint timestamp (ms since epoch). `null` if the surface has never
  // painted (just-mounted, off-screen, etc.).
  lastPaintAt: number | null;
  // GPU resource state. `true` for WebGL surfaces that have logged a
  // `webgl_context_lost` event since their last successful repaint.
  contextLost: boolean;
  // Active renderer pipeline. Surfaces that swap renderers (xterm
  // WebGL→Canvas2D fallback) update this on swap.
  rendererMode: SurfaceRendererMode;
}

export interface RenderableSurface {
  readonly id: string;
  readonly kind: SurfaceKind;
  // Visibility transition. Surfaces use this to gate their internal paint
  // loops (e.g. cancel an idle RAF when going hidden) and to align their
  // `visible` health field. Idempotent — repeated calls with the same
  // value must be cheap.
  setVisible(visible: boolean): void;
  // Synchronously schedule a repaint. `severity = heavy` implies the
  // framebuffer was almost certainly lost (visibility hidden→visible,
  // sleep/wake) and the surface should additionally rebuild any GPU
  // resources (xterm: WebGL atlas; canvas: cached glyphs; etc.).
  forceRepaint(reason: string, severity: SurfaceRecoverySeverity): void;
  // Diagnostic snapshot. Called by the paint heartbeat watchdog and the
  // Help → Report Issue snapshot collector.
  getHealth(): SurfaceHealth;
}

export interface SurfaceDispatchResult {
  total: number;
  refreshed: number;
  errors: number;
}
