import type { HydraRuntime } from "./types.ts";
import { StandaloneRuntime } from "./standalone.ts";
import { TermCanvasRuntime } from "./termcanvas.ts";

export type { HydraRuntime, RuntimeTerminalRef, RuntimeTerminalStatus, RuntimeTelemetrySnapshot, TerminalCreateOptions } from "./types.ts";
export { StandaloneRuntime, TermCanvasRuntime };

let cachedRuntime: HydraRuntime | null = null;
let cachedOverride: HydraRuntime | null = null;

/**
 * Explicit override for tests or advanced callers. Subsequent getRuntime()
 * calls return this runtime until resetRuntime() is called.
 */
export function setRuntime(runtime: HydraRuntime): void {
  cachedOverride = runtime;
  cachedRuntime = runtime;
}

/** Clear the cached runtime so the next getRuntime() re-detects. */
export function resetRuntime(): void {
  cachedRuntime = null;
  cachedOverride = null;
}

/**
 * Selector precedence:
 *   1. Test/explicit override via setRuntime()
 *   2. HYDRA_STANDALONE=1 → force standalone
 *   3. HYDRA_STANDALONE=0 → force TermCanvas
 *   4. Auto-detect: if caller is inside a TermCanvas terminal (env var set)
 *      OR the TC daemon port file exists → TermCanvas. Otherwise → standalone.
 *
 * Auto-detect keeps the local desktop path working by default. Users on
 * a bare machine (no TC, no env var) automatically get standalone mode
 * with zero configuration.
 */
export function getRuntime(): HydraRuntime {
  if (cachedOverride) return cachedOverride;
  if (cachedRuntime) return cachedRuntime;

  const override = process.env.HYDRA_STANDALONE?.trim();
  if (override === "1" || override === "true") {
    cachedRuntime = new StandaloneRuntime();
    return cachedRuntime;
  }
  if (override === "0" || override === "false") {
    cachedRuntime = new TermCanvasRuntime();
    return cachedRuntime;
  }

  const tc = new TermCanvasRuntime();
  if (tc.isAvailable() || process.env.TERMCANVAS_TERMINAL_ID) {
    cachedRuntime = tc;
    return cachedRuntime;
  }
  cachedRuntime = new StandaloneRuntime();
  return cachedRuntime;
}
