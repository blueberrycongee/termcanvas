import { create } from "zustand";

export type Locale = "en" | "zh";

function getLocalStorage():
  | Pick<Storage, "getItem" | "setItem">
  | null {
  const candidate = (
    globalThis as { localStorage?: { getItem?: unknown; setItem?: unknown } }
  ).localStorage;

  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function"
  ) {
    return candidate as Pick<Storage, "getItem" | "setItem">;
  }

  return null;
}

function detectLocale(): Locale {
  const saved = getLocalStorage()?.getItem("termcanvas-locale") ?? null;
  if (saved === "en" || saved === "zh") return saved;
  if (typeof navigator !== "undefined" && navigator.language.startsWith("zh"))
    return "zh";
  return "en";
}

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    getLocalStorage()?.setItem("termcanvas-locale", locale);
    set({ locale });
  },
}));
