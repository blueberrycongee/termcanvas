/**
 * Single point of truth for "the renderer might have missed paint cycles and
 * should recover." Fuses every signal we have access to — DOM
 * `visibilitychange`, `window.focus`, the W3C Page Lifecycle API
 * (`freeze`/`resume`), and our main->renderer `tc:lifecycle:visible` IPC —
 * into one normalized event stream `onRecovery({ reason, severity })`.
 *
 * Why centralize: pre-existing recovery code listened to two of these events
 * directly inside `terminalRuntimeStore`, and PR 1 added a third (lifecycle
 * IPC). Each fired its own `refreshAllTerminalRenderers` call. On a single
 * Cmd+Tab return all three would fire within ~tens of milliseconds, so the
 * same recovery work ran 2-3 times. Centralizing here gives us:
 *   - one place to add new triggers (e.g. paint heartbeat in PR 5)
 *   - per-severity dedup so multiple signals coalesce into one dispatch
 *   - explicit severity (`light` = refresh only, `heavy` = refresh + atlas
 *     rebuild because the framebuffer was almost certainly lost)
 *   - diagnostic visibility into which trigger fired and which got coalesced
 *
 * Severity mapping is conservative: anything that implies the page was truly
 * hidden (visibility hidden→visible, Page Lifecycle resume, main-side
 * focus/show IPC which is our only reliable Space-switch detector) is
 * `heavy`. A bare `window.focus` is `light` because the page may have only
 * lost focus briefly without ever being unpainted.
 */

export type RecoverySeverity = "light" | "heavy";

export interface RecoveryEvent {
  reason: string;
  severity: RecoverySeverity;
}

export type RecoveryListener = (event: RecoveryEvent) => void;

export interface VisibilityObserverDiagnosticEvent {
  kind: string;
  data?: Record<string, unknown>;
}

export interface VisibilityObserverDeps {
  /** Subscribe to the lifecycle IPC pushed by the main process. */
  subscribeLifecycleIPC?: (
    callback: (payload: { reason: string; timestamp: number }) => void,
  ) => () => void;
  /** Optional clock injection for tests. */
  now?: () => number;
  /** Optional diagnostic sink. */
  recordDiagnostic?: (event: VisibilityObserverDiagnosticEvent) => void;
  /** Cooldown window in ms before another dispatch of the same severity is
   *  allowed. Defaults to 200ms — long enough to coalesce the typical
   *  visibilitychange + window.focus + main-IPC trio fired by a single OS
   *  event, short enough that a real second event isn't missed. */
  dedupWindowMs?: number;
}

const DEFAULT_DEDUP_WINDOW_MS = 200;

export class VisibilityObserver {
  private readonly listeners = new Set<RecoveryListener>();
  private readonly now: () => number;
  private readonly recordDiagnostic?: (
    event: VisibilityObserverDiagnosticEvent,
  ) => void;
  private readonly subscribeLifecycleIPC?: VisibilityObserverDeps["subscribeLifecycleIPC"];
  private readonly dedupWindowMs: number;

  private installed = false;
  private cleanups: Array<() => void> = [];
  private lastBySeverity: Record<RecoverySeverity, number> = {
    light: 0,
    heavy: 0,
  };

  constructor(deps: VisibilityObserverDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.recordDiagnostic = deps.recordDiagnostic;
    this.subscribeLifecycleIPC = deps.subscribeLifecycleIPC;
    this.dedupWindowMs = deps.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
  }

  /**
   * Subscribe to all signal sources. Idempotent — calling twice is a no-op.
   * In environments without a DOM (tests), only the IPC source is wired.
   */
  install(): void {
    if (this.installed) return;
    this.installed = true;

    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      const onVisibility = () => {
        if (document.visibilityState === "visible") {
          this.dispatch("visibility_change_to_visible", "heavy");
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      this.cleanups.push(() =>
        document.removeEventListener("visibilitychange", onVisibility),
      );

      // Page Lifecycle API: `resume` fires when Chromium un-freezes the
      // renderer (long backgrounding, OS pressure). Distinct from
      // visibilitychange and not always paired with it.
      const onResume = () => this.dispatch("page_lifecycle_resume", "heavy");
      document.addEventListener("resume", onResume);
      this.cleanups.push(() => document.removeEventListener("resume", onResume));

      const onFreeze = () => {
        // We don't dispatch on freeze (renderer is going dormant), but log it
        // so diagnostics show the full lifecycle.
        this.recordDiagnostic?.({ kind: "page_lifecycle_freeze" });
      };
      document.addEventListener("freeze", onFreeze);
      this.cleanups.push(() => document.removeEventListener("freeze", onFreeze));
    }

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      const onFocus = () => this.dispatch("window_focus", "light");
      window.addEventListener("focus", onFocus);
      this.cleanups.push(() => window.removeEventListener("focus", onFocus));
    }

    if (this.subscribeLifecycleIPC) {
      const off = this.subscribeLifecycleIPC((payload) => {
        this.dispatch(`lifecycle_ipc_${payload.reason}`, "heavy");
      });
      this.cleanups.push(off);
    }
  }

  /** Detach all listeners. Mostly for tests. */
  uninstall(): void {
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch {
        // best-effort
      }
    }
    this.cleanups = [];
    this.installed = false;
  }

  onRecovery(listener: RecoveryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Public for callers that synthesize their own triggers (e.g. paint
   *  heartbeat in a future PR). Goes through the same dedup logic. */
  dispatch(reason: string, severity: RecoverySeverity): void {
    const now = this.now();
    const sinceSame = now - this.lastBySeverity[severity];
    if (sinceSame < this.dedupWindowMs) {
      this.recordDiagnostic?.({
        kind: "visibility_observer_skipped",
        data: { reason, severity, ms_since_same_severity: sinceSame },
      });
      return;
    }
    // A `light` dispatch shortly after a `heavy` one is redundant — the
    // heavy work covers everything light would have done.
    if (severity === "light") {
      const sinceHeavy = now - this.lastBySeverity.heavy;
      if (sinceHeavy < this.dedupWindowMs) {
        this.recordDiagnostic?.({
          kind: "visibility_observer_skipped",
          data: {
            reason,
            severity,
            superseded_by: "heavy",
            ms_since_heavy: sinceHeavy,
          },
        });
        return;
      }
    }
    this.lastBySeverity[severity] = now;
    this.recordDiagnostic?.({
      kind: "visibility_observer_dispatch",
      data: { reason, severity },
    });
    for (const listener of this.listeners) {
      try {
        listener({ reason, severity });
      } catch {
        // a misbehaving subscriber must not break others
      }
    }
  }
}

let singleton: VisibilityObserver | null = null;

export function getVisibilityObserver(
  deps?: VisibilityObserverDeps,
): VisibilityObserver {
  if (!singleton) {
    singleton = new VisibilityObserver(deps);
  }
  return singleton;
}

/** Test-only: reset the renderer-wide singleton between cases. */
export function __resetVisibilityObserverForTesting(): void {
  if (singleton) {
    singleton.uninstall();
  }
  singleton = null;
}
