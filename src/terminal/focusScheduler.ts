// Multi-tier focus scheduler.
//
// Why not just RAF (the previous strategy):
// macOS Space switching pauses RAF callbacks under occlusion throttling.
// A 24× RAF retry that never fires looks identical to "succeeded" from the
// caller's view — no error, no log — so we silently lose focus and the
// user clicks an unresponsive terminal until the next paint cycle wakes
// things up. The fallback chain below escalates to setTimeout, which is
// not subject to the same throttle.
//
// Tier order (each retry escalates):
//   1. microtask  — same task, runs before paint; cheapest defer
//   2. RAF        — next paint; gives layout/composer state time to settle
//   3. timeout50  — 50 ms timer; robust to RAF throttle
//   4. timeout200 — 200 ms timer; backoff for stubborn cases
//
// Each tier callback checks `pending.generation` so a later
// `scheduleTerminalFocus` call cancels in-flight tiers cleanly without
// depending on each tier's native cancel API (microtask has none).

import type { RenderDiagnosticEventInput } from "../../shared/render-diagnostics";

export type FocusTier = "microtask" | "raf" | "timeout50" | "timeout200";

export const FOCUS_TIER_ORDER: readonly FocusTier[] = [
  "microtask",
  "raf",
  "timeout50",
  "timeout200",
];

export interface PendingFocus {
  // Generation counter — bumped on every schedule/cancel call. Tier
  // callbacks read this to detect that they were superseded.
  generation: number;
  // Active RAF id (if any) so we can synchronously cancel.
  rafId: number | null;
  // Active timeout id (if any).
  timeoutId: ReturnType<typeof setTimeout> | null;
  // Tier index for the next attempt; resets to 0 on a fresh schedule.
  attempt: number;
}

export function createPendingFocus(): PendingFocus {
  return { generation: 0, rafId: null, timeoutId: null, attempt: 0 };
}

export interface FocusScheduleOptions {
  requestMicrotask?: (callback: () => void) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  setTimeoutFn?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
  onAttempt?: (info: { tier: FocusTier; attempt: number; focused: boolean }) => void;
  recordDiagnostic?: (event: RenderDiagnosticEventInput) => void;
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 12;

function defaultRequestMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }
  Promise.resolve().then(callback);
}

function tierForAttempt(attempt: number): FocusTier {
  // Walk the chain on the first cycle, then stick on the last tier so that
  // long-throttled RAF / repeated focus failures keep using setTimeout(200)
  // rather than burning microtasks.
  if (attempt < FOCUS_TIER_ORDER.length) {
    return FOCUS_TIER_ORDER[attempt]!;
  }
  return "timeout200";
}

function resolveRequestFrame(): (cb: FrameRequestCallback) => number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame;
  return (cb) => setTimeout(() => cb(performance.now?.() ?? Date.now()), 16) as unknown as number;
}

function resolveCancelFrame(): (id: number) => void {
  if (typeof cancelAnimationFrame === "function") return cancelAnimationFrame;
  return (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

export function scheduleTerminalFocus(
  focus: () => boolean | void,
  pending: PendingFocus,
  options: FocusScheduleOptions = {},
): void {
  const requestMicrotask = options.requestMicrotask ?? defaultRequestMicrotask;
  const requestFrame = options.requestFrame ?? resolveRequestFrame();
  const cancelFrame = options.cancelFrame ?? resolveCancelFrame();
  const setTimeoutFn =
    options.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((id) => clearTimeout(id));
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // Cancel any in-flight schedule from the prior call; bump generation so
  // its tier callback no-ops if it had already fired into the queue.
  cancelInFlight(pending, cancelFrame, clearTimeoutFn);
  pending.generation += 1;
  pending.attempt = 0;
  const generation = pending.generation;

  const runAttempt = () => {
    if (pending.generation !== generation) return;

    pending.rafId = null;
    pending.timeoutId = null;

    const tier = tierForAttempt(pending.attempt);
    const focused = focus() !== false;
    options.onAttempt?.({ tier, attempt: pending.attempt, focused });

    if (focused) {
      options.recordDiagnostic?.({
        kind: "terminal_focus_scheduler_succeeded",
        data: { tier, attempt: pending.attempt },
      });
      pending.attempt = 0;
      return;
    }

    pending.attempt += 1;
    if (pending.attempt >= maxAttempts) {
      options.recordDiagnostic?.({
        kind: "terminal_focus_scheduler_exhausted",
        data: { attempts: pending.attempt },
      });
      pending.attempt = 0;
      return;
    }

    queueNextTier(pending, generation, runAttempt, {
      requestMicrotask,
      requestFrame,
      setTimeoutFn,
    });
  };

  queueNextTier(pending, generation, runAttempt, {
    requestMicrotask,
    requestFrame,
    setTimeoutFn,
  });
}

function queueNextTier(
  pending: PendingFocus,
  generation: number,
  runAttempt: () => void,
  schedulers: {
    requestMicrotask: (cb: () => void) => void;
    requestFrame: (cb: FrameRequestCallback) => number;
    setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  },
): void {
  const tier = tierForAttempt(pending.attempt);
  const guarded = () => {
    if (pending.generation !== generation) return;
    runAttempt();
  };
  switch (tier) {
    case "microtask":
      schedulers.requestMicrotask(guarded);
      return;
    case "raf":
      pending.rafId = schedulers.requestFrame(() => guarded());
      return;
    case "timeout50":
      pending.timeoutId = schedulers.setTimeoutFn(guarded, 50);
      return;
    case "timeout200":
      pending.timeoutId = schedulers.setTimeoutFn(guarded, 200);
      return;
  }
}

function cancelInFlight(
  pending: PendingFocus,
  cancelFrame: (id: number) => void,
  clearTimeoutFn: (id: ReturnType<typeof setTimeout>) => void,
): void {
  if (pending.rafId !== null) {
    cancelFrame(pending.rafId);
    pending.rafId = null;
  }
  if (pending.timeoutId !== null) {
    clearTimeoutFn(pending.timeoutId);
    pending.timeoutId = null;
  }
}

export function cancelScheduledTerminalFocus(
  pending: PendingFocus,
  options: Pick<FocusScheduleOptions, "cancelFrame" | "clearTimeoutFn"> = {},
): void {
  const cancelFrame = options.cancelFrame ?? resolveCancelFrame();
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((id) => clearTimeout(id));
  cancelInFlight(pending, cancelFrame, clearTimeoutFn);
  // Bump generation so any microtask already in-flight no-ops.
  pending.generation += 1;
  pending.attempt = 0;
}

