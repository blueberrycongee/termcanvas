import { create } from "zustand";
import { hasPrimaryModifier } from "../hooks/shortcutTarget.ts";

export interface ShortcutMap {
  addProject: string;
  cycleFocusLevel: string;
  newTerminal: string;
  saveWorkspace: string;
  saveWorkspaceAs: string;
  renameTerminalTitle: string;
  nextTerminal: string;
  prevTerminal: string;
  clearFocus: string;
  closeFocused: string;
  toggleRightPanel: string;
  toggleStarFocused: string;
  openTerminalFind: string;
  globalSearch: string;
  commandPalette: string;
  toggleUsageOverlay: string;
  toggleSessionsOverlay: string;
  toggleActivityHeatmap: string;
  toggleSnapshotHistory: string;
  toggleHub: string;
  nextCanvas: string;
  prevCanvas: string;
  openCanvasManager: string;
}

const LEGACY_DEFAULT_SHORTCUTS: ShortcutMap = {
  addProject: "mod+o",
  cycleFocusLevel: "mod+g",
  newTerminal: "mod+t",
  saveWorkspace: "mod+s",
  saveWorkspaceAs: "mod+shift+s",
  renameTerminalTitle: "mod+;",
  nextTerminal: "mod+]",
  prevTerminal: "mod+[",
  clearFocus: "mod+e",
  closeFocused: "mod+d",
  toggleRightPanel: "mod+/",
  toggleStarFocused: "mod+shift+f",
  openTerminalFind: "mod+f",
  globalSearch: "mod+k",
  commandPalette: "mod+p",
  toggleUsageOverlay: "mod+shift+u",
  toggleSessionsOverlay: "mod+shift+h",
  toggleActivityHeatmap: "mod+shift+a",
  toggleSnapshotHistory: "mod+shift+t",
  toggleHub: "mod+shift+j",
  nextCanvas: "mod+shift+]",
  prevCanvas: "mod+shift+[",
  openCanvasManager: "mod+shift+n",
};

const ALT_DEFAULT_SHORTCUTS: ShortcutMap = {
  addProject: "alt+o",
  cycleFocusLevel: "alt+g",
  newTerminal: "alt+t",
  saveWorkspace: "alt+s",
  saveWorkspaceAs: "alt+shift+s",
  renameTerminalTitle: "alt+;",
  nextTerminal: "alt+]",
  prevTerminal: "alt+[",
  clearFocus: "alt+e",
  closeFocused: "alt+d",
  toggleRightPanel: "alt+/",
  toggleStarFocused: "alt+shift+f",
  openTerminalFind: "alt+f",
  globalSearch: "alt+k",
  commandPalette: "alt+p",
  toggleUsageOverlay: "alt+shift+u",
  toggleSessionsOverlay: "alt+shift+h",
  toggleActivityHeatmap: "alt+shift+a",
  toggleSnapshotHistory: "alt+shift+t",
  toggleHub: "alt+shift+j",
  nextCanvas: "alt+shift+]",
  prevCanvas: "alt+shift+[",
  openCanvasManager: "alt+shift+n",
};

export const DEFAULT_SHORTCUTS: ShortcutMap = { ...LEGACY_DEFAULT_SHORTCUTS };

const STORAGE_KEY = "termcanvas-shortcuts";

export type ShortcutPlatform = "darwin" | "win32" | "linux";

function getShortcutPlatform(): ShortcutPlatform {
  if (typeof window !== "undefined" && window.termcanvas?.app.platform) {
    return window.termcanvas.app.platform;
  }
  if (typeof process !== "undefined") {
    const platform = process.platform;
    if (platform === "darwin" || platform === "win32" || platform === "linux") {
      return platform;
    }
  }
  return "darwin";
}

function hasUnsupportedPlatformModifier(
  e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
  platform: ShortcutPlatform,
): boolean {
  return platform === "darwin"
    ? e.ctrlKey && !e.metaKey
    : e.metaKey && !e.ctrlKey;
}

export function getDefaultShortcuts(
  platform: ShortcutPlatform = getShortcutPlatform(),
): ShortcutMap {
  return platform === "darwin"
    ? { ...LEGACY_DEFAULT_SHORTCUTS }
    : { ...ALT_DEFAULT_SHORTCUTS };
}

function isLegacyDefaultShortcutMap(shortcuts: ShortcutMap): boolean {
  return (
    Object.entries(LEGACY_DEFAULT_SHORTCUTS) as Array<
      [keyof ShortcutMap, string]
    >
  ).every(([key, value]) => shortcuts[key] === value);
}

// Drop any legacy tile-size / span shortcut keys that may still live in
// localStorage from older builds. The feature has been removed.
const REMOVED_SHORTCUT_KEYS = [
  "spanDefault",
  "spanWide",
  "spanTall",
  "spanLarge",
  "tileSizeDefault",
  "tileSizeWide",
  "tileSizeTall",
  "tileSizeLarge",
];

function migrateLegacyShortcutKeys(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const migrated: Record<string, unknown> = { ...raw };
  for (const key of REMOVED_SHORTCUT_KEYS) {
    delete migrated[key];
  }
  // Free Cmd/Alt+F for an upcoming in-terminal find feature: bump
  // toggleStarFocused off the old default if the user never customized it.
  if (migrated.toggleStarFocused === "mod+f") {
    migrated.toggleStarFocused = "mod+shift+f";
  } else if (migrated.toggleStarFocused === "alt+f") {
    migrated.toggleStarFocused = "alt+shift+f";
  }
  return migrated;
}

function loadShortcuts(): ShortcutMap {
  const platform = getShortcutPlatform();
  const defaults = getDefaultShortcuts(platform);
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const rawParsed = JSON.parse(saved) as Record<string, unknown>;
      const migrated = migrateLegacyShortcutKeys(rawParsed);
      const parsed = {
        ...defaults,
        ...migrated,
      } as ShortcutMap;
      if (platform !== "darwin" && isLegacyDefaultShortcutMap(parsed)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
        return defaults;
      }
      // Persist the migrated form so subsequent reads don't replay it.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      return parsed;
    }
  } catch {
  }
  return defaults;
}

interface ShortcutStore {
  shortcuts: ShortcutMap;
  setShortcut: (key: keyof ShortcutMap, value: string) => void;
  resetAll: () => void;
}

export const useShortcutStore = create<ShortcutStore>((set) => ({
  shortcuts: loadShortcuts(),

  setShortcut: (key, value) =>
    set((state) => {
      const next = { ...state.shortcuts, [key]: value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { shortcuts: next };
    }),

  resetAll: () => {
    const defaults = getDefaultShortcuts();
    localStorage.removeItem(STORAGE_KEY);
    return set({ shortcuts: defaults });
  },
}));

/**
 * Convert a KeyboardEvent into a shortcut string like "mod+b", "mod+]", "escape".
 */
export function eventToShortcut(e: KeyboardEvent): string {
  const platform = getShortcutPlatform();
  if (hasUnsupportedPlatformModifier(e, platform)) return "";
  const parts: string[] = [];
  if (hasPrimaryModifier(e, platform)) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");

  const key = e.key.toLowerCase();
  // Don't include modifier-only presses
  if (["control", "meta", "shift", "alt"].includes(key)) return "";
  parts.push(key);
  return parts.join("+");
}

// e.code (physical key) for punctuation literals so chords like
// `mod+shift+]` don't silently break — Shift+] yields `e.key === "}"`
// on US/UK/most European layouts, which would never match the literal.
// Falling back to e.code keeps these chords layout-stable.
const PUNCT_KEY_TO_CODE: Record<string, string> = {
  "]": "BracketRight",
  "[": "BracketLeft",
  "/": "Slash",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
};

export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const platform = getShortcutPlatform();
  if (hasUnsupportedPlatformModifier(e, platform)) return false;
  const parts = shortcut.split("+");
  const needsMod = parts.includes("mod");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.includes("alt");
  const key = parts.filter(
    (p) => p !== "mod" && p !== "shift" && p !== "alt",
  )[0];

  const hasMod = hasPrimaryModifier(e, platform);

  if (needsMod && !hasMod) return false;
  if (!needsMod && hasMod) return false;
  if (needsShift !== e.shiftKey) return false;
  if (needsAlt !== e.altKey) return false;
  if (e.key.toLowerCase() === key) return true;
  const code = PUNCT_KEY_TO_CODE[key];
  return code !== undefined && e.code === code;
}

/**
 * Check whether a KeyboardEvent matches any currently registered app shortcut.
 */
export function isRegisteredAppShortcutEvent(
  e: KeyboardEvent,
  shortcuts: ShortcutMap = useShortcutStore.getState().shortcuts,
): boolean {
  return Object.values(shortcuts).some((shortcut) => matchesShortcut(e, shortcut));
}

/**
 * Format a shortcut string for display, e.g. "mod+b" -> "⌘ B" or "Ctrl B".
 */
export function formatShortcut(shortcut: string, isMac: boolean): string {
  return shortcut
    .split("+")
    .map((p) => {
      if (p === "mod") return isMac ? "⌘" : "Ctrl";
      if (p === "shift") return isMac ? "⇧" : "Shift";
      if (p === "alt") return isMac ? "⌥" : "Alt";
      if (p === "escape") return "Esc";
      return p.toUpperCase();
    })
    .join(" ");
}
