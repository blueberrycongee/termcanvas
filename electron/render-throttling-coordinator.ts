/**
 * Coordinates `webContents.setBackgroundThrottling` based on whether the app
 * has active work that should keep rendering at full speed even when the
 * window is occluded (e.g. the user switched macOS Spaces).
 *
 * Default Chromium behavior throttles backgrounded renderers — RAF stalls,
 * timers are clamped, the WebGL framebuffer can become stale. For an active
 * agent / running PTY, that produces the "blank terminal after Space switch"
 * symptom users have reported.
 *
 * Strategy: leave throttling enabled while idle (saves battery), disable it
 * when activity has been observed within the last `activeWindowMs`. Caller
 * marks activity via `markActivity(reason)`; a periodic re-evaluation flips
 * back to idle once the active window elapses.
 */

export interface ThrottlingTarget {
  setBackgroundThrottling(allowed: boolean): void;
}

export interface RenderThrottlingDiagnostic {
  kind: string;
  data?: Record<string, unknown>;
}

export interface RenderThrottlingCoordinatorOptions {
  target: ThrottlingTarget;
  activeWindowMs?: number;
  reevaluateIntervalMs?: number;
  recordDiagnostic?: (event: RenderThrottlingDiagnostic) => void;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

const DEFAULT_ACTIVE_WINDOW_MS = 30_000;
const DEFAULT_REEVALUATE_INTERVAL_MS = 5_000;

export class RenderThrottlingCoordinator {
  private readonly target: ThrottlingTarget;
  private readonly activeWindowMs: number;
  private readonly reevaluateIntervalMs: number;
  private readonly recordDiagnostic?: (
    event: RenderThrottlingDiagnostic,
  ) => void;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  private lastActivityAt = 0;
  private lastActivitySource: string | null = null;
  private throttlingAllowed = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: RenderThrottlingCoordinatorOptions) {
    this.target = options.target;
    this.activeWindowMs = options.activeWindowMs ?? DEFAULT_ACTIVE_WINDOW_MS;
    this.reevaluateIntervalMs =
      options.reevaluateIntervalMs ?? DEFAULT_REEVALUATE_INTERVAL_MS;
    this.recordDiagnostic = options.recordDiagnostic;
    this.now = options.now ?? Date.now;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = this.setIntervalFn(() => {
      this.evaluate("tick");
    }, this.reevaluateIntervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  markActivity(source: string): void {
    this.lastActivityAt = this.now();
    this.lastActivitySource = source;
    if (this.throttlingAllowed) {
      this.evaluate(`activity:${source}`);
    }
  }

  isThrottlingAllowed(): boolean {
    return this.throttlingAllowed;
  }

  private hasActiveWork(): boolean {
    if (this.lastActivityAt === 0) return false;
    return this.now() - this.lastActivityAt < this.activeWindowMs;
  }

  private evaluate(reason: string): void {
    const desired = !this.hasActiveWork();
    if (desired === this.throttlingAllowed) return;
    this.throttlingAllowed = desired;
    this.target.setBackgroundThrottling(desired);
    this.recordDiagnostic?.({
      kind: "background_throttling_changed",
      data: {
        allowed: desired,
        reason,
        last_activity_source: this.lastActivitySource,
        ms_since_last_activity:
          this.lastActivityAt === 0 ? null : this.now() - this.lastActivityAt,
      },
    });
  }
}
