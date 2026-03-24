const IS_DEV = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

interface PerfOptions {
  details?: Record<string, unknown>;
  thresholdMs?: number;
}

export function logSlowRendererPath(
  label: string,
  startedAt: number,
  options: PerfOptions = {},
): number {
  const durationMs = performance.now() - startedAt;
  const thresholdMs = options.thresholdMs ?? 16;

  if (IS_DEV && durationMs >= thresholdMs) {
    console.log(`[Perf] ${label}`, {
      ms: Number(durationMs.toFixed(1)),
      ...options.details,
    });
  }

  return durationMs;
}

export function measureRendererSync<T>(
  label: string,
  run: () => T,
  options: PerfOptions = {},
): T {
  const startedAt = performance.now();

  try {
    return run();
  } finally {
    logSlowRendererPath(label, startedAt, options);
  }
}
