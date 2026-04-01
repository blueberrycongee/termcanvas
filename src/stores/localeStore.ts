import { create } from "zustand";

export type Locale = "en" | "zh";

function detectLocale(): Locale {
  const saved =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("termcanvas-locale")
      : null;
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
    localStorage.setItem("termcanvas-locale", locale);
    set({ locale });
  },
}));
