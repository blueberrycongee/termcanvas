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

export function acquireWebGL(terminalId: string, xterm: Terminal): boolean {
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
      // addon may already be disposed
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
    // Never evict the focused terminal
    if (entry.terminalId === focusedId) continue;
    if (!oldest || entry.lastUsed < oldest.lastUsed) {
      oldest = entry;
    }
  }
  if (oldest) {
    try {
      oldest.addon.dispose();
    } catch {
      // addon may already be disposed
    }
    entries.delete(oldest.terminalId);
  }
}
