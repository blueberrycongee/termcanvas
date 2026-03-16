import { create } from "zustand";

const DEFAULT_BLUR = 1.5;

interface PreferencesStore {
  /** Blur intensity in px (0 = off, max 3) */
  animationBlur: number;
  setAnimationBlur: (value: number) => void;
}

const STORAGE_KEY = "termcanvas-preferences";

function loadPreferences(): { animationBlur: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const v = parsed.animationBlur;
      // migrate old boolean values
      if (v === true) return { animationBlur: DEFAULT_BLUR };
      if (v === false) return { animationBlur: 0 };
      if (typeof v === "number" && v >= 0 && v <= 3) return { animationBlur: v };
    }
  } catch {
    // ignore
  }
  return { animationBlur: DEFAULT_BLUR };
}

function savePreferences(state: { animationBlur: number }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const usePreferencesStore = create<PreferencesStore>((set, get) => ({
  animationBlur: loadPreferences().animationBlur,
  setAnimationBlur: (value) => {
    const clamped = Math.round(Math.max(0, Math.min(3, value)) * 10) / 10;
    set({ animationBlur: clamped });
    savePreferences({ ...get(), animationBlur: clamped });
  },
}));
