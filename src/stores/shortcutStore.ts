import { create } from "zustand";
import { hasPrimaryModifier } from "../hooks/shortcutTarget.ts";

export interface ShortcutMap {
  addProject: string;
  toggleSidebar: string;
  newTerminal: string;
  nextTerminal: string;
  prevTerminal: string;
  clearFocus: string;
  spanDefault: string;
  spanWide: string;
  spanTall: string;
  spanLarge: string;
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  addProject: "mod+o",
  toggleSidebar: "mod+b",
  newTerminal: "mod+t",
  nextTerminal: "mod+]",
  prevTerminal: "mod+[",
  clearFocus: "mod+e",
  spanDefault: "mod+1",
  spanWide: "mod+2",
  spanTall: "mod+3",
  spanLarge: "mod+4",
};

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

function loadShortcuts(): ShortcutMap {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_SHORTCUTS, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SHORTCUTS };
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
    localStorage.removeItem(STORAGE_KEY);
    return set({ shortcuts: { ...DEFAULT_SHORTCUTS } });
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

/**
 * Check if a KeyboardEvent matches a shortcut string.
 */
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
  return e.key.toLowerCase() === key;
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
