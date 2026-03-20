import { create } from "zustand";
import type { ITheme } from "@xterm/xterm";

export type Theme = "dark" | "light";

interface ThemeStore {
  theme: Theme;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: "dark",
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      return { theme: next };
    }),
}));

export const XTERM_THEMES: Record<Theme, ITheme> = {
  dark: {
    background: "#101010",
    foreground: "#e8e8e8",
    cursor: "#e8e8e8",
    cursorAccent: "#101010",
    selectionBackground: "rgba(0, 112, 243, 0.3)",
    black: "#111111",
    red: "#ee0000",
    green: "#0070f3",
    yellow: "#f5a623",
    blue: "#0070f3",
    magenta: "#7928ca",
    cyan: "#79ffe1",
    white: "#ededed",
    brightBlack: "#444444",
    brightRed: "#ff4444",
    brightGreen: "#50e3c2",
    brightYellow: "#f7b955",
    brightBlue: "#3291ff",
    brightMagenta: "#a855f7",
    brightCyan: "#79ffe1",
    brightWhite: "#fafafa",
  },
  light: {
    background: "#eae8e4",
    foreground: "#1c1917",
    cursor: "#1c1917",
    cursorAccent: "#eae8e4",
    selectionBackground: "rgba(37, 99, 235, 0.18)",
    black: "#1c1917",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#d97706",
    blue: "#2563eb",
    magenta: "#7c3aed",
    cyan: "#0d9488",
    white: "#e7e5e4",
    brightBlack: "#44403c",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#eab308",
    brightBlue: "#3b82f6",
    brightMagenta: "#8b5cf6",
    brightCyan: "#14b8a6",
    brightWhite: "#f3f2ef",
  },
};
