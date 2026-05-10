// Paint heartbeat watchdog.
//
// `VisibilityObserver` dispatches recovery on *external* signals
// (visibilitychange, page lifecycle resume, lifecycle IPC, window focus).
// Those cover the macOS-Space-switch case and most occlusion paths, but
// not "the surface stopped painting while it's still considered
// visible". Causes include xterm's IntersectionObserver mistakenly
// thinking the tile is offscreen, a stuck WebGL pipeline that lost
// context but didn't fire the loss event, or a renderer-side crash that
// silently broke RAF.
//
// The watchdog ticks every `intervalMs` (default 2 s). On each tick:
//  1. If `document.visibilityState !== "visible"`, no paints are
//     expected — skip. (We rely on visibilitychange to trigger recovery
//     when the page returns to visible.)
//  2. Walk the surface registry for surfaces whose `health.visible` is
//     true.
//  3. If a surface's `lastPaintAt` is older than `stallThresholdMs`
//     (default 5 s), or it has never painted despite being visible for
//     longer than that, dispatch through the observer with
//     `"paint_heartbeat_stall"` at `"heavy"` severity.
//
// We dispatch through the observer (not the surface registry directly)
// so the dedup logic and the diagnostic stream stay shared with the
// other recovery sources. Same dispatch path = same fix landing in one
// place.

import type { RenderableSurface } from "../../shared/render-surface";
import type { VisibilityObserver } from "./visibilityObserver";

export interface PaintHeartbeatDeps {
  observer: VisibilityObserver;
  listSurfaces: () => RenderableSurface[];
  documentVisible: () => boolean;
  now?: () => number;
  recordDiagnostic?: (event: { kind: string; data?: Record<string, unknown> }) => void;
  intervalMs?: number;
  stallThresholdMs?: number;
  cooldownMs?: number;
  setIntervalFn?: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void;
}

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_STALL_THRESHOLD_MS = 5_000;
// Don't fire two heartbeat dispatches closer than this. The
// VisibilityObserver has its own 200 ms dedup, but heartbeat ticks are
// 2 s apart so per-source rate limiting is needed to avoid pile-on while
// the recovery is still in flight.
const DEFAULT_COOLDOWN_MS = 10_000;

export class PaintHeartbeatWatchdog {
  private readonly observer: VisibilityObserver;
  private readonly listSurfaces: () => RenderableSurface[];
  private readonly documentVisible: () => boolean;
  private readonly now: () => number;
  private readonly recordDiagnostic?: PaintHeartbeatDeps["recordDiagnostic"];
  private readonly intervalMs: number;
  private readonly stallThresholdMs: number;
  private readonly cooldownMs: number;
  private readonly setIntervalFn: NonNullable<PaintHeartbeatDeps["setIntervalFn"]>;
  private readonly clearIntervalFn: NonNullable<PaintHeartbeatDeps["clearIntervalFn"]>;

  private timer: ReturnType<typeof setInterval> | null = null;
  // First time each surface id was observed visible without a recent
  // paint. Used to detect "never painted yet" stalls without a separate
  // mountedAt field on the surface.
  private firstVisibleSeenAt = new Map<string, number>();
  private lastDispatchAt = 0;

  constructor(deps: PaintHeartbeatDeps) {
    this.observer = deps.observer;
    this.listSurfaces = deps.listSurfaces;
    this.documentVisible = deps.documentVisible;
    this.now = deps.now ?? Date.now;
    this.recordDiagnostic = deps.recordDiagnostic;
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.stallThresholdMs = deps.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
    this.cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.setIntervalFn = deps.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
    this.clearIntervalFn = deps.clearIntervalFn ?? ((id) => clearInterval(id));
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = this.setIntervalFn(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
    this.firstVisibleSeenAt.clear();
  }

  // Visible for tests.
  tick(): void {
    if (!this.documentVisible()) {
      // No paints expected; clear "first visible" tracking so the next
      // visible→hidden→visible cycle doesn't immediately fire a stall
      // based on a stale clock from before the page was hidden.
      this.firstVisibleSeenAt.clear();
      return;
    }

    const now = this.now();
    const stalled: Array<{
      id: string;
      kind: string;
      reason: "no_paint_yet" | "paint_stale";
      ageMs: number;
    }> = [];

    for (const surface of this.listSurfaces()) {
      let health;
      try {
        health = surface.getHealth();
      } catch {
        continue;
      }
      if (!health.visible) {
        this.firstVisibleSeenAt.delete(surface.id);
        continue;
      }

      if (health.lastPaintAt !== null) {
        const age = now - health.lastPaintAt;
        if (age >= this.stallThresholdMs) {
          stalled.push({
            id: surface.id,
            kind: surface.kind,
            reason: "paint_stale",
            ageMs: age,
          });
        }
        // Once a surface has actually painted, we no longer need to
        // track "first visible".
        this.firstVisibleSeenAt.delete(surface.id);
        continue;
      }

      // Never painted: track when we first noticed it visible. If still
      // unpainted past the stall threshold, treat as stalled.
      const firstSeen =
        this.firstVisibleSeenAt.get(surface.id) ??
        (this.firstVisibleSeenAt.set(surface.id, now), now);
      const age = now - firstSeen;
      if (age >= this.stallThresholdMs) {
        stalled.push({
          id: surface.id,
          kind: surface.kind,
          reason: "no_paint_yet",
          ageMs: age,
        });
      }
    }

    if (stalled.length === 0) return;

    if (now - this.lastDispatchAt < this.cooldownMs) {
      this.recordDiagnostic?.({
        kind: "paint_heartbeat_stall_skipped_cooldown",
        data: {
          stalled_count: stalled.length,
          ms_since_last_dispatch: now - this.lastDispatchAt,
        },
      });
      return;
    }

    this.lastDispatchAt = now;
    this.recordDiagnostic?.({
      kind: "paint_heartbeat_stall_detected",
      data: {
        stalled_count: stalled.length,
        stalled,
      },
    });

    this.observer.dispatch("paint_heartbeat_stall", "heavy");
  }
}
