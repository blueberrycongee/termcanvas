import type { TerminalTheme } from "./theme.ts";
import { applyMinimumContrastToTheme } from "./themeContrast.ts";

export interface TerminalThemeState {
  getCurrentTheme: () => TerminalTheme;
  setBaseTheme: (theme: TerminalTheme) => TerminalTheme;
  setMinimumContrastRatio: (ratio: number) => TerminalTheme;
}

export function createTerminalThemeState(
  initialTheme: TerminalTheme,
  initialMinimumContrastRatio: number,
): TerminalThemeState {
  let baseTheme = initialTheme;
  let minimumContrastRatio = initialMinimumContrastRatio;
  let currentTheme = applyMinimumContrastToTheme(
    baseTheme,
    minimumContrastRatio,
  );

  return {
    getCurrentTheme: () => currentTheme,
    setBaseTheme: (theme) => {
      baseTheme = theme;
      currentTheme = applyMinimumContrastToTheme(
        baseTheme,
        minimumContrastRatio,
      );
      return currentTheme;
    },
    setMinimumContrastRatio: (ratio) => {
      minimumContrastRatio = ratio;
      currentTheme = applyMinimumContrastToTheme(
        baseTheme,
        minimumContrastRatio,
      );
      return currentTheme;
    },
  };
}
