import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { useNotificationStore } from "../stores/notificationStore";

interface PoolEntry {
  terminalId: string;
  addon: WebglAddon;
  xterm: Terminal;
  lastUsed: number;
}

const MAX_CONTEXTS = 16;
const entries = new Map<string, PoolEntry>();
let focusedId: string | null = null;

/**
 * Atlas recovery — addresses the "silent corruption" case where the
 * WebGL renderer's glyph atlas goes visually wrong without the GPU
 * driver firing `webglcontextlost`. Symptoms: patches of the terminal
 * look smeared / repeating / off-palette; selecting text locally
 * fixes the selected region (xterm's selection-aware path redraws
 * that range without consulting the cached atlas); a theme toggle
 * fully fixes it (that path rebuilds the atlas from scratch).
 *
 * ghostty-web's own theme-swap bug prompted us to understand this
 * pipeline in depth (see the block comment on `applyThemeToRuntime`
 * in terminalRuntimeStore) but the corruption itself is an
 * xterm + GPU-driver interaction, not a ghostty issue.
 *
 * Since the driver gives no signal when the cache gets corrupted, we
 * can't detect it. What we CAN do is proactively call
 * `WebglAddon.clearTextureAtlas()` on events that commonly correlate
 * with atlas invalidation:
 *
 *   1. devicePixelRatio change — macOS external monitor swap, OS
 *      scale adjust, browser zoom. The atlas was rasterized at the
 *      previous DPR; all cached glyphs are now wrong-resolution.
 *   2. document visibility flip hidden→visible — long background
 *      tabs have their GPU textures evicted on most drivers; the
 *      texture IDs may still be valid from JS's perspective but
 *      point at undefined GPU memory.
 *
 * `clearTextureAtlas` just drops the cache and schedules a viewport
 * redraw on the next rAF tick — it's cheap, non-tearing, and
 * invisible to the user when the atlas was already correct. So
 * being aggressive about calling it is the right trade-off.
 *
 * Additional manual hook: `rebuildAllAtlases()` is exported for
 * future integration (e.g. a "fix rendering" keyboard shortcut or
 * a telemetry-triggered rebuild) without the caller having to peek
 * into the pool directly.
 */
function rebuildAllAtlases(): void {
  for (const entry of entries.values()) {
    try {
      entry.addon.clearTextureAtlas();
    } catch {
      // Addon may be mid-disposal or the underlying context
      // genuinely dead; swallow and let the next lifecycle event
      // (context loss, attach) handle it.
    }
  }
}

export function rebuildTerminalAtlas(terminalId?: string): void {
  if (!terminalId) {
    rebuildAllAtlases();
    return;
  }
  const entry = entries.get(terminalId);
  if (!entry) return;
  try {
    entry.addon.clearTextureAtlas();
  } catch {
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
      rebuildAllAtlases();
      dprMql.removeEventListener("change", onDprChange);
      dprMql = buildDprMql();
      dprMql.addEventListener("change", onDprChange);
    };
    dprMql.addEventListener("change", onDprChange);
  }

  // Visibility listener. Fires on every tab-switch-back; cheap
  // enough that we don't gate it on "was hidden long enough for
  // the GPU to evict textures" — clearTextureAtlas is a no-op
  // for an already-correct cache.
  if (
    typeof document !== "undefined" &&
    typeof document.addEventListener === "function"
  ) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        rebuildAllAtlases();
      }
    });
  }

  // Window focus listener. In Electron, plain Cmd+Tab / Alt+Tab
  // between apps does NOT fire `visibilitychange` — the window
  // stays "visible" from the document's perspective even though
  // the OS may have de-prioritised GPU resources while focus was
  // elsewhere. Focus is the canonical "user came back to this
  // app" signal; pair it with visibility to cover both
  // minimise-and-restore and app-switch round-trips.
  //
  // Also catches:
  //   - Lid close + reopen (focus lost on sleep, regained on wake)
  //   - Screen lock + unlock
  //   - macOS Space switch away and back (when Spaces move focus
  //     rather than hiding the window)
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("focus", () => {
      rebuildAllAtlases();
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
    return true;
  }

  if (entries.size >= MAX_CONTEXTS) {
    evictLRU();
  }

  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      const count = (parseInt(localStorage.getItem("tc:webgl-loss-count") ?? "0", 10) || 0) + 1;
      localStorage.setItem("tc:webgl-loss-count", String(count));
      localStorage.setItem("tc:webgl-loss-last", new Date().toISOString());
      useNotificationStore.getState().notify("warn", `WebGL context lost for terminal ${terminalId} (total: ${count})`);
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
    return true;
  } catch {
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
    try {
      oldest.addon.dispose();
    } catch {
    }
    entries.delete(oldest.terminalId);
  }
}
