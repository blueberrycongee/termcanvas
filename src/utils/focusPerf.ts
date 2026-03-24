const IS_DEV = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

interface ActiveFocusTransition {
  label: string;
  targetId: string | null;
  startedAt: number;
}

interface FocusProfilerDetails {
  thresholdMs?: number;
  details?: Record<string, unknown>;
}

let activeTransition: ActiveFocusTransition | null = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

export function markFocusTransition(label: string, targetId: string | null) {
  if (!IS_DEV) {
    return;
  }

  activeTransition = {
    label,
    targetId,
    startedAt: performance.now(),
  };

  if (clearTimer) {
    clearTimeout(clearTimer);
  }

  clearTimer = setTimeout(() => {
    activeTransition = null;
    clearTimer = null;
  }, 400);
}

export function logFocusProfiler(
  component: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  options: FocusProfilerDetails = {},
) {
  if (!IS_DEV || !activeTransition) {
    return;
  }

  const thresholdMs = options.thresholdMs ?? 4;
  if (actualDuration < thresholdMs) {
    return;
  }

  console.log("[Perf] focusTransition", {
    label: activeTransition.label,
    targetId: activeTransition.targetId,
    component,
    phase,
    actualDurationMs: Number(actualDuration.toFixed(1)),
    sinceStartMs: Number((performance.now() - activeTransition.startedAt).toFixed(1)),
    ...options.details,
  });
}
