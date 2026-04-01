import { create } from "zustand";
import type { TerminalType } from "../types/index.ts";

const DEFAULT_BLUR = 0;
const DEFAULT_FONT_SIZE = 13;
const DEFAULT_MIN_CONTRAST = 1;
const LEGACY_ENABLED_BLUR = 1.5;

export interface CliCommandConfig {
  command: string;
  args: string[];
}

interface PreferencesStore {
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
  /** When false, the toolbar browser shortcut stays hidden */
  browserEnabled: boolean;
  /** When true, auto-summary is enabled for CLI terminals */
  summaryEnabled: boolean;
  /** Which CLI to use for generating summaries */
  summaryCli: "claude" | "codex";
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
  setBrowserEnabled: (value: boolean) => void;
  setSummaryEnabled: (value: boolean) => void;
  setSummaryCli: (value: "claude" | "codex") => void;
  setCli: (type: TerminalType, config: CliCommandConfig | null) => void;
}

const STORAGE_KEY = "termcanvas-preferences";

function loadPreferences(): { animationBlur: number; terminalFontSize: number; terminalFontFamily: string; composerEnabled: boolean; drawingEnabled: boolean; browserEnabled: boolean; summaryEnabled: boolean; summaryCli: "claude" | "codex"; minimumContrastRatio: number; cliCommands: Partial<Record<TerminalType, CliCommandConfig>> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
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

      let browserEnabled = false;
      if (parsed.browserEnabled === true) browserEnabled = true;

      let summaryEnabled = false;
      if (parsed.summaryEnabled === true) summaryEnabled = true;

      let summaryCli: "claude" | "codex" = "claude";
      if (parsed.summaryCli === "codex") summaryCli = "codex";

      let minimumContrastRatio = DEFAULT_MIN_CONTRAST;
      const mcr = parsed.minimumContrastRatio;
      if (typeof mcr === "number" && mcr >= 1 && mcr <= 7) minimumContrastRatio = mcr;

      const cliCommands: Partial<Record<TerminalType, CliCommandConfig>> = {};
      if (parsed.cliCommands && typeof parsed.cliCommands === "object") {
        for (const [key, val] of Object.entries(parsed.cliCommands)) {
          if (val && typeof val === "object" && typeof (val as CliCommandConfig).command === "string") {
            cliCommands[key as TerminalType] = val as CliCommandConfig;
          }
        }
      }

      return { animationBlur: blur, terminalFontSize: fontSize, terminalFontFamily: fontFamily, composerEnabled, drawingEnabled, browserEnabled, summaryEnabled, summaryCli, minimumContrastRatio, cliCommands };
    }
  } catch {
    // ignore
  }
  return { animationBlur: DEFAULT_BLUR, terminalFontSize: DEFAULT_FONT_SIZE, terminalFontFamily: "geist-mono", composerEnabled: false, drawingEnabled: false, browserEnabled: false, summaryEnabled: false, summaryCli: "claude", minimumContrastRatio: DEFAULT_MIN_CONTRAST, cliCommands: {} };
}

function savePreferences(state: { animationBlur: number; terminalFontSize: number; terminalFontFamily: string; composerEnabled: boolean; drawingEnabled: boolean; browserEnabled: boolean; summaryEnabled: boolean; summaryCli: "claude" | "codex"; minimumContrastRatio: number; cliCommands: Partial<Record<TerminalType, CliCommandConfig>> }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const initialPrefs = loadPreferences();

export const usePreferencesStore = create<PreferencesStore>((set, get) => ({
  animationBlur: initialPrefs.animationBlur,
  terminalFontSize: initialPrefs.terminalFontSize,
  terminalFontFamily: initialPrefs.terminalFontFamily,
  composerEnabled: initialPrefs.composerEnabled,
  drawingEnabled: initialPrefs.drawingEnabled,
  browserEnabled: initialPrefs.browserEnabled,
  summaryEnabled: initialPrefs.summaryEnabled,
  summaryCli: initialPrefs.summaryCli,
  minimumContrastRatio: initialPrefs.minimumContrastRatio,
  cliCommands: initialPrefs.cliCommands,
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
  setBrowserEnabled: (value) => {
    set({ browserEnabled: value });
    savePreferences({ ...get(), browserEnabled: value });
  },
  setSummaryEnabled: (value) => {
    set({ summaryEnabled: value });
    savePreferences({ ...get(), summaryEnabled: value });
  },
  setSummaryCli: (value) => {
    set({ summaryCli: value });
    savePreferences({ ...get(), summaryCli: value });
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
