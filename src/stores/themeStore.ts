import { create } from "zustand";
import type { ITheme } from "@xterm/xterm";

export type Theme = "dark" | "light";

interface ThemeStore {
  theme: Theme;
  toggleTheme: () => void;
}

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem("termcanvas-theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return "dark";
}

const initialTheme = loadTheme();
if (initialTheme === "light") {
  document.documentElement.setAttribute("data-theme", "light");
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: initialTheme,
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("termcanvas-theme", next);
      } catch {}
      return { theme: next };
    }),
}));

export const XTERM_THEMES: Record<Theme, ITheme> = {
  dark: {
    background: "#1a1918",
    foreground: "#e4e2df",
    cursor: "#e4e2df",
    cursorAccent: "#1a1918",
    selectionBackground: "rgba(196, 192, 184, 0.25)",
    black: "#1e1d1c",
    red: "#d4685a",
    green: "#6ab07a",
    yellow: "#c9a255",
    blue: "#5b9ef5",
    magenta: "#9b7ad8",
    cyan: "#6cc4b0",
    white: "#d5d3cf",
    brightBlack: "#4e4b48",
    brightRed: "#e87272",
    brightGreen: "#7ec48e",
    brightYellow: "#d4a24e",
    brightBlue: "#7db4f7",
    brightMagenta: "#b196e2",
    brightCyan: "#85d4c2",
    brightWhite: "#f0eeeb",
  },
  light: {
    background: "#eae8e4",
    foreground: "#1c1917",
    cursor: "#1c1917",
    cursorAccent: "#eae8e4",
    selectionBackground: "rgba(68, 64, 60, 0.18)",
    black: "#44403c",
    red: "#b91c1c",
    green: "#166534",
    yellow: "#92400e",
    blue: "#1e40af",
    magenta: "#7c3aed",
    cyan: "#0b6158",
    white: "#6b6660",
    brightBlack: "#57534e",
    brightRed: "#b91c1c",
    brightGreen: "#166534",
    brightYellow: "#92400e",
    brightBlue: "#1e3a8a",
    brightMagenta: "#6d28d9",
    brightCyan: "#0d4f4a",
    brightWhite: "#6b6660",
  },
};
