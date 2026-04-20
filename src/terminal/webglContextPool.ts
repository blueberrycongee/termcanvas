import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { useNotificationStore } from "../stores/notificationStore";
import { useLocaleStore } from "../stores/localeStore";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import { recordRenderDiagnostic } from "./renderDiagnostics";

interface PoolEntry {
  terminalId: string;
  addon: WebglAddon;
  xterm: Terminal;
  lastUsed: number;
}

const MAX_CONTEXTS = 16;
const WEBGL_NOTIFICATION_THROTTLE_MS = 60_000;
const WEBGL_UNAVAILABLE_NOTICE_KEY = "tc:webgl-unavailable-notice-at";
const WEBGL_CONTEXT_LOST_NOTICE_KEY = "tc:webgl-context-lost-notice-at";
const entries = new Map<string, PoolEntry>();
let focusedId: string | null = null;
const dictionaries = { en, zh } as const;

function getPoolDiagnosticData(): Record<string, unknown> {
  return {
    focused_terminal_id: focusedId,
    max_contexts: MAX_CONTEXTS,
    pool_size: entries.size,
    tracked_terminal_ids: [...entries.keys()],
  };
}

function recordWebGLDiagnostic(
  kind: string,
  terminalId?: string,
  data: Record<string, unknown> = {},
): void {
  recordRenderDiagnostic({
    kind,
    terminalId,
    data: {
      ...getPoolDiagnosticData(),
      ...data,
    },
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getT() {
  const locale = useLocaleStore.getState().locale;
  return { ...en, ...dictionaries[locale] };
}

function shouldNotifyWebGLIssue(storageKey: string): boolean {
  try {
    const raw = localStorage.getItem(storageKey);
    const lastNotifiedAt = raw ? Number.parseInt(raw, 10) : 0;
    if (
      Number.isFinite(lastNotifiedAt) &&
      lastNotifiedAt > 0 &&
      Date.now() - lastNotifiedAt < WEBGL_NOTIFICATION_THROTTLE_MS
    ) {
      return false;
    }
    localStorage.setItem(storageKey, String(Date.now()));
  } catch {
    // Ignore storage failures and still show the notice once.
  }

  return true;
}

function notifyWebGLFallbackHint(
  kind: "context_lost" | "unavailable",
): void {
  const storageKey =
    kind === "context_lost"
      ? WEBGL_CONTEXT_LOST_NOTICE_KEY
      : WEBGL_UNAVAILABLE_NOTICE_KEY;
  if (!shouldNotifyWebGLIssue(storageKey)) {
    return;
  }

  const t = getT();
  useNotificationStore.getState().notify(
    "warn",
    kind === "context_lost"
      ? t.terminal_renderer_webgl_context_lost
      : t.terminal_renderer_webgl_failed,
  );
}

/**
 * Atlas recovery.
 *
 * Current evidence:
 *   - The WebGL glyph atlas can become visually wrong without any
 *     `webglcontextlost` event.
 *   - Theme toggle fully restores it, and local selection redraw can
 *     restore only the selected range, so the bug behaves like stale
 *     atlas contents rather than bad terminal data.
 *   - Window-level return-from-background is only one trigger. Recent
 *     diagnostics also show corruption around focus, layout, and
 *     viewport-scale churn while the window is still visible.
 *
 * Responsibility split:
 *   - This module owns app-wide invalidation signals that do not need
 *     terminal lifecycle context:
 *       1. `devicePixelRatio` change
 *       2. `document.visibilityState` hidden→visible
 *       3. `window` focus regained
 *   - Per-terminal recovery for create / attach / focus / settled
 *     viewport scale lives in `terminalRuntimeStore` and `TerminalTile`,
 *     because those paths depend on runtime attachment state and canvas
 *     animation state.
 *
 * Manual escape hatch: `rebuildTerminalAtlas()` stays exported for the
 * toolbar "Refresh terminal rendering" action and any future targeted
 * diagnostics.
 */
function rebuildAllAtlases(reason = "unspecified"): void {
  recordWebGLDiagnostic("render_atlas_rebuild_all", undefined, {
    reason,
  });
  for (const entry of entries.values()) {
    try {
      entry.addon.clearTextureAtlas();
    } catch (error) {
      recordWebGLDiagnostic("render_atlas_rebuild_failed", entry.terminalId, {
        error: formatError(error),
        reason,
      });
      // Addon may be mid-disposal or the underlying context
      // genuinely dead; swallow and let the next lifecycle event
      // (context loss, attach) handle it.
    }
  }
}

export function rebuildTerminalAtlas(
  terminalId?: string,
  reason = "unspecified",
): void {
  if (!terminalId) {
    rebuildAllAtlases(reason);
    return;
  }
  const entry = entries.get(terminalId);
  if (!entry) {
    recordWebGLDiagnostic("render_atlas_rebuild_skipped", terminalId, {
      reason,
    });
    return;
  }
  recordWebGLDiagnostic("render_atlas_rebuild", terminalId, {
    reason,
  });
  try {
    entry.addon.clearTextureAtlas();
  } catch (error) {
    recordWebGLDiagnostic("render_atlas_rebuild_failed", terminalId, {
      error: formatError(error),
      reason,
    });
    // Swallow — same reasoning as above.
  }
}

let atlasRecoveryInstalled = false;
function installAtlasRecoveryListeners(): void {
  if (atlasRecoveryInstalled) return;
  atlasRecoveryInstalled = true;

  // Feature-gate on the specific APIs we need, not just `window`.
  // Test environments (node --test against jsdom-like stubs) have
  // `window` and `document` but not `matchMedia`, so the naive
  // `typeof window !== 'undefined'` guard is insufficient.

  // DPR-change listener. matchMedia is the only reliable way to
  // detect `window.devicePixelRatio` transitions from JS; the MQL
  // fires `change` exactly when `dppx` crosses the threshold, at
  // which point we re-subscribe at the new value so the next
  // transition still fires. Kept alive for the lifetime of the app.
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const buildDprMql = () =>
      window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    let dprMql = buildDprMql();
    const onDprChange = () => {
      rebuildAllAtlases("device_pixel_ratio_change");
      dprMql.removeEventListener("change", onDprChange);
      dprMql = buildDprMql();
      dprMql.addEventListener("change", onDprChange);
    };
    dprMql.addEventListener("change", onDprChange);
  }

  // Visibility listener. Fires on hidden→visible transitions:
  // window minimise + restore, Electron-level hide + show.
  // Does NOT fire on Cmd+Tab between apps — the focus listener
  // below covers that path.
  if (
    typeof document !== "undefined" &&
    typeof document.addEventListener === "function"
  ) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        rebuildAllAtlases("document_visible");
      }
    });
  }

  // Focus listener. Covers paths visibilitychange doesn't:
  //   - Cmd+Tab / Alt+Tab between apps (document stays "visible"
  //     through app-switch in Electron)
  //   - Lid close + reopen
  //   - Screen lock + unlock
  //   - macOS Space switch back (when Spaces move focus rather
  //     than hiding the window)
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("focus", () => {
      rebuildAllAtlases("window_focus");
    });
  }
}

export function acquireWebGL(terminalId: string, xterm: Terminal): boolean {
  // Install atlas-recovery listeners on first use. Lazy because the
  // module may be imported in environments without `window` (tests,
  // headless builds); deferring to first acquire skips the feature
  // entirely in those environments instead of erroring.
  installAtlasRecoveryListeners();

  if (entries.has(terminalId)) {
    touch(terminalId);
    recordWebGLDiagnostic("webgl_acquire_reused", terminalId, {
      cols: xterm.cols,
      rows: xterm.rows,
    });
    return true;
  }

  if (entries.size >= MAX_CONTEXTS) {
    evictLRU();
  }

  recordWebGLDiagnostic("webgl_acquire_attempt", terminalId, {
    cols: xterm.cols,
    rows: xterm.rows,
  });

  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      const count = (parseInt(localStorage.getItem("tc:webgl-loss-count") ?? "0", 10) || 0) + 1;
      localStorage.setItem("tc:webgl-loss-count", String(count));
      localStorage.setItem("tc:webgl-loss-last", new Date().toISOString());
      recordWebGLDiagnostic("webgl_context_lost", terminalId, {
        context_loss_count: count,
      });
      notifyWebGLFallbackHint("context_lost");
      addon.dispose();
      entries.delete(terminalId);
    });
    xterm.loadAddon(addon);
    entries.set(terminalId, {
      terminalId,
      addon,
      xterm,
      lastUsed: Date.now(),
    });
    recordWebGLDiagnostic("webgl_acquire_success", terminalId, {
      cols: xterm.cols,
      rows: xterm.rows,
    });
    return true;
  } catch (error) {
    recordWebGLDiagnostic("webgl_acquire_failed", terminalId, {
      error: formatError(error),
    });
    notifyWebGLFallbackHint("unavailable");
    return false;
  }
}

export function releaseWebGL(terminalId: string): void {
  const entry = entries.get(terminalId);
  if (entry) {
    try {
      entry.addon.dispose();
    } catch {
    }
    entries.delete(terminalId);
    recordWebGLDiagnostic("webgl_release", terminalId);
  }
  if (focusedId === terminalId) {
    focusedId = null;
  }
}

export function touch(terminalId: string): void {
  const entry = entries.get(terminalId);
  if (entry) {
    entry.lastUsed = Date.now();
  }
  focusedId = terminalId;
  recordWebGLDiagnostic("webgl_touch", terminalId);
}

function evictLRU(): void {
  let oldest: PoolEntry | null = null;
  for (const entry of entries.values()) {
    if (entry.terminalId === focusedId) continue;
    if (!oldest || entry.lastUsed < oldest.lastUsed) {
      oldest = entry;
    }
  }
  if (oldest) {
    recordWebGLDiagnostic("webgl_evict_lru", oldest.terminalId, {
      last_used: oldest.lastUsed,
    });
    try {
      oldest.addon.dispose();
    } catch {
    }
    entries.delete(oldest.terminalId);
  }
}
