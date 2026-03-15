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
    background: "#0a0a0a",
    foreground: "#ededed",
    cursor: "#ededed",
    cursorAccent: "#0a0a0a",
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
    background: "#fafafa",
    foreground: "#111111",
    cursor: "#111111",
    cursorAccent: "#fafafa",
    selectionBackground: "rgba(0, 112, 243, 0.2)",
    black: "#000000",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#d97706",
    blue: "#2563eb",
    magenta: "#7c3aed",
    cyan: "#0d9488",
    white: "#e5e5e5",
    brightBlack: "#737373",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#eab308",
    brightBlue: "#3b82f6",
    brightMagenta: "#8b5cf6",
    brightCyan: "#14b8a6",
    brightWhite: "#fafafa",
  },
};
