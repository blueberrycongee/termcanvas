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

export function rebuildTerminalAtlas(
  terminalId?: string,
  reason = "unspecified",
): void {
  if (!terminalId) {
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
      }
    }
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
  }
}

function resetEntryWebGL(entry: PoolEntry, reason: string): boolean {
  recordWebGLDiagnostic("webgl_reset", entry.terminalId, { reason });
  const wasFocused = focusedId === entry.terminalId;
  releaseWebGL(entry.terminalId);
  const reacquired = acquireWebGL(entry.terminalId, entry.xterm);
  if (reacquired && wasFocused) {
    touch(entry.terminalId);
  }
  try {
    entry.xterm.refresh(0, Math.max(0, entry.xterm.rows - 1));
  } catch {
    // Terminal may be mid-disposal; reset is best-effort recovery.
  }
  return reacquired;
}

export function resetWebGL(terminalId?: string, reason = "unspecified"): void {
  if (!terminalId) {
    const currentEntries = [...entries.values()];
    recordWebGLDiagnostic("webgl_reset_all", undefined, {
      reason,
      reset_count: currentEntries.length,
    });
    for (const entry of currentEntries) {
      resetEntryWebGL(entry, reason);
    }
    return;
  }

  const entry = entries.get(terminalId);
  if (!entry) {
    recordWebGLDiagnostic("webgl_reset_skipped", terminalId, { reason });
    return;
  }

  resetEntryWebGL(entry, reason);
}

export function acquireWebGL(terminalId: string, xterm: Terminal): boolean {
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
      // After addon disposal xterm creates a fallback DomRenderer, but the
      // new renderer's canvas is empty. Force a full repaint so the buffer
      // content is immediately visible instead of showing a blank terminal.
      try {
        xterm.refresh(0, xterm.rows - 1);
      } catch { /* terminal may already be disposed */ }
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
