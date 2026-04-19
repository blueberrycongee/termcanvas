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
 * Atlas recovery.
 *
 * Observed pre-0.30.2:
 *   - After the app has been away for a long time, returning to a
 *     terminal shows garbled characters.
 *   - No `webglcontextlost` event is fired while the corruption is
 *     happening.
 *   - Manual workaround (full): toggling the theme restores all
 *     glyphs.
 *   - Manual workaround (local): selecting a range of text
 *     restores that range; unselected regions stay garbled.
 *
 * Fix (0.30.2+): call `WebglAddon.clearTextureAtlas()` on three
 * signals that correlate with "returning after being away":
 *
 *   1. `devicePixelRatio` change — external monitor swap, OS scale
 *      change, browser zoom.
 *   2. `document.visibilityState` flip hidden→visible — window
 *      minimise, Electron-level hide + show. Does NOT fire on
 *      plain Cmd+Tab between apps in Electron; the document stays
 *      "visible" through app-switch.
 *   3. `window` focus regained — Cmd+Tab back, lid close + open,
 *      screen lock + unlock, macOS Space switch back.
 *
 * Observed post-0.30.2:
 *   - Short Cmd+Tab round-trips: no user-visible change (no flash,
 *     no blank frame, no rerender flicker).
 *   - Long-absence case has not been re-tested in this pass.
 *
 * See also `applyThemeToRuntime` in terminalRuntimeStore for the
 * ghostty-web theme-swap investigation that prompted us to read
 * through this pipeline.
 *
 * Manual escape hatch: `rebuildTerminalAtlas()` is exported and
 * wired to the toolbar "Refresh terminal rendering" button for
 * corruption modes these three signals don't catch.
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
        rebuildAllAtlases();
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
