import { create } from "zustand";
import type { TerminalType } from "../types";

const DEFAULT_BLUR = 0;
const DEFAULT_FONT_SIZE = 13;
const DEFAULT_MIN_CONTRAST = 1;
const LEGACY_ENABLED_BLUR = 1.5;

export interface CliCommandConfig {
  command: string;
  args: string[];
}

interface PreferencesData {
  animationBlur: number;
  terminalFontSize: number;
  terminalFontFamily: string;
  composerEnabled: boolean;
  drawingEnabled: boolean;
  minimumContrastRatio: number;
  cliCommands: Partial<Record<TerminalType, CliCommandConfig>>;
}

interface PreferencesStore extends PreferencesData {
  /** Blur intensity in px (0 = off, max 3) */
  animationBlur: number;
  /** Terminal (xterm) font size in px (6–24) */
  terminalFontSize: number;
  /** Terminal font ID from fontRegistry */
  terminalFontFamily: string;
  /** When false, composer bar is hidden and xterm gets direct focus */
  composerEnabled: boolean;
  /** When false, drawing panel and drawing layer are hidden */
  drawingEnabled: boolean;
  /** xterm minimum contrast ratio (1 = off, max 7) */
  minimumContrastRatio: number;
  /** Per-terminal-type CLI command overrides */
  cliCommands: Partial<Record<TerminalType, CliCommandConfig>>;
  setAnimationBlur: (value: number) => void;
  setMinimumContrastRatio: (value: number) => void;
  setTerminalFontSize: (value: number) => void;
  setTerminalFontFamily: (fontId: string) => void;
  setComposerEnabled: (value: boolean) => void;
  setDrawingEnabled: (value: boolean) => void;
  setCli: (type: TerminalType, config: CliCommandConfig | null) => void;
}

const DEFAULTS: PreferencesData = {
  animationBlur: DEFAULT_BLUR,
  terminalFontSize: DEFAULT_FONT_SIZE,
  terminalFontFamily: "geist-mono",
  composerEnabled: false,
  drawingEnabled: false,
  minimumContrastRatio: DEFAULT_MIN_CONTRAST,
  cliCommands: {},
};

function parsePreferences(parsed: Record<string, unknown>): PreferencesData {
  let blur = DEFAULT_BLUR;
  const v = parsed.animationBlur;
  if (v === true) blur = LEGACY_ENABLED_BLUR;
  else if (v === false) blur = 0;
  else if (typeof v === "number" && v >= 0 && v <= 3) blur = v;

  let fontSize = DEFAULT_FONT_SIZE;
  const f = parsed.terminalFontSize;
  if (typeof f === "number" && f >= 6 && f <= 24) fontSize = f;

  let fontFamily = "geist-mono";
  const ff = parsed.terminalFontFamily;
  if (typeof ff === "string" && ff.length > 0) fontFamily = ff;

  let composerEnabled = false;
  if (parsed.composerEnabled === true) composerEnabled = true;

  let drawingEnabled = false;
  if (parsed.drawingEnabled === true) drawingEnabled = true;

  let minimumContrastRatio = DEFAULT_MIN_CONTRAST;
  const mcr = parsed.minimumContrastRatio;
  if (typeof mcr === "number" && mcr >= 1 && mcr <= 7) minimumContrastRatio = mcr;

  const cliCommands: Partial<Record<TerminalType, CliCommandConfig>> = {};
  if (parsed.cliCommands && typeof parsed.cliCommands === "object") {
    for (const [key, val] of Object.entries(parsed.cliCommands as Record<string, unknown>)) {
      if (val && typeof val === "object" && typeof (val as CliCommandConfig).command === "string") {
        cliCommands[key as TerminalType] = val as CliCommandConfig;
      }
    }
  }

  return { animationBlur: blur, terminalFontSize: fontSize, terminalFontFamily: fontFamily, composerEnabled, drawingEnabled, minimumContrastRatio, cliCommands };
}

function getPrefsData(state: PreferencesStore): PreferencesData {
  const { animationBlur, terminalFontSize, terminalFontFamily, composerEnabled, drawingEnabled, minimumContrastRatio, cliCommands } = state;
  return { animationBlur, terminalFontSize, terminalFontFamily, composerEnabled, drawingEnabled, minimumContrastRatio, cliCommands };
}

function savePreferences(state: PreferencesStore): void {
  const data = getPrefsData(state);
  if (window.termcanvas?.preferences) {
    window.termcanvas.preferences.save(data);
  }
}

export const usePreferencesStore = create<PreferencesStore>((set, get) => ({
  ...DEFAULTS,
  setAnimationBlur: (value) => {
    const clamped = Math.round(Math.max(0, Math.min(3, value)) * 10) / 10;
    set({ animationBlur: clamped });
    savePreferences({ ...get(), animationBlur: clamped });
  },
  setMinimumContrastRatio: (value) => {
    const clamped = Math.round(Math.max(1, Math.min(7, value)) * 10) / 10;
    set({ minimumContrastRatio: clamped });
    savePreferences({ ...get(), minimumContrastRatio: clamped });
  },
  setTerminalFontSize: (value) => {
    const clamped = Math.max(6, Math.min(24, Math.round(value)));
    set({ terminalFontSize: clamped });
    savePreferences({ ...get(), terminalFontSize: clamped });
  },
  setTerminalFontFamily: (fontId) => {
    set({ terminalFontFamily: fontId });
    savePreferences({ ...get(), terminalFontFamily: fontId });
  },
  setComposerEnabled: (value) => {
    set({ composerEnabled: value });
    savePreferences({ ...get(), composerEnabled: value });
  },
  setDrawingEnabled: (value) => {
    set({ drawingEnabled: value });
    savePreferences({ ...get(), drawingEnabled: value });
  },
  setCli: (type, config) => {
    const current = { ...get().cliCommands };
    if (config) {
      current[type] = config;
    } else {
      delete current[type];
    }
    set({ cliCommands: current });
    savePreferences({ ...get(), cliCommands: current });
  },
}));

/** Load preferences from disk via IPC and hydrate the store. Call once on app startup. */
export async function hydratePreferences(): Promise<void> {
  if (!window.termcanvas?.preferences) return;
  try {
    const saved = await window.termcanvas.preferences.load();
    if (saved && typeof saved === "object") {
      const prefs = parsePreferences(saved as Record<string, unknown>);
      usePreferencesStore.setState(prefs);
    }
  } catch (err) {
    console.error("[PreferencesStore] failed to hydrate from disk:", err);
  }
}
