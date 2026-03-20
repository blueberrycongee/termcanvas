import { create } from "zustand";

const DEFAULT_BLUR = 0;
const DEFAULT_FONT_SIZE = 13;
const LEGACY_ENABLED_BLUR = 1.5;

interface PreferencesStore {
  /** Blur intensity in px (0 = off, max 3) */
  animationBlur: number;
  /** Terminal (xterm) font size in px (6–24) */
  terminalFontSize: number;
  /** Terminal font ID from fontRegistry */
  terminalFontFamily: string;
  /** When false, composer bar is hidden and xterm gets direct focus */
  composerEnabled: boolean;
  setAnimationBlur: (value: number) => void;
  setTerminalFontSize: (value: number) => void;
  setTerminalFontFamily: (fontId: string) => void;
  setComposerEnabled: (value: boolean) => void;
}

const STORAGE_KEY = "termcanvas-preferences";

function loadPreferences(): { animationBlur: number; terminalFontSize: number; terminalFontFamily: string; composerEnabled: boolean } {
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

      return { animationBlur: blur, terminalFontSize: fontSize, terminalFontFamily: fontFamily, composerEnabled };
    }
  } catch {
    // ignore
  }
  return { animationBlur: DEFAULT_BLUR, terminalFontSize: DEFAULT_FONT_SIZE, terminalFontFamily: "geist-mono", composerEnabled: false };
}

function savePreferences(state: { animationBlur: number; terminalFontSize: number; terminalFontFamily: string; composerEnabled: boolean }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const initialPrefs = loadPreferences();

export const usePreferencesStore = create<PreferencesStore>((set, get) => ({
  animationBlur: initialPrefs.animationBlur,
  terminalFontSize: initialPrefs.terminalFontSize,
  terminalFontFamily: initialPrefs.terminalFontFamily,
  composerEnabled: initialPrefs.composerEnabled,
  setAnimationBlur: (value) => {
    const clamped = Math.round(Math.max(0, Math.min(3, value)) * 10) / 10;
    set({ animationBlur: clamped });
    savePreferences({ ...get(), animationBlur: clamped });
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
}));
