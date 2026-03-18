import { create } from "zustand";

const DEFAULT_BLUR = 0;
const DEFAULT_FONT_SIZE = 13;
const LEGACY_ENABLED_BLUR = 1.5;

interface PreferencesStore {
  /** Blur intensity in px (0 = off, max 3) */
  animationBlur: number;
  /** Terminal (xterm) font size in px (6–24) */
  terminalFontSize: number;
  setAnimationBlur: (value: number) => void;
  setTerminalFontSize: (value: number) => void;
}

const STORAGE_KEY = "termcanvas-preferences";

function loadPreferences(): { animationBlur: number; terminalFontSize: number } {
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

      return { animationBlur: blur, terminalFontSize: fontSize };
    }
  } catch {
    // ignore
  }
  return { animationBlur: DEFAULT_BLUR, terminalFontSize: DEFAULT_FONT_SIZE };
}

function savePreferences(state: { animationBlur: number; terminalFontSize: number }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const initialPrefs = loadPreferences();

export const usePreferencesStore = create<PreferencesStore>((set, get) => ({
  animationBlur: initialPrefs.animationBlur,
  terminalFontSize: initialPrefs.terminalFontSize,
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
}));
