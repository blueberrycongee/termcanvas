import test from "node:test";
import assert from "node:assert/strict";

import { createTerminalThemeState } from "../src/terminal/themeState.ts";
import type { TerminalTheme } from "../src/terminal/theme.ts";

const DARK_THEME: TerminalTheme = {
  background: "#111111",
  foreground: "#333333",
  black: "#000000",
  red: "#330000",
  green: "#003300",
  yellow: "#333300",
  blue: "#000033",
  magenta: "#330033",
  cyan: "#003333",
  white: "#666666",
  brightBlack: "#222222",
  brightRed: "#550000",
  brightGreen: "#005500",
  brightYellow: "#555500",
  brightBlue: "#000055",
  brightMagenta: "#550055",
  brightCyan: "#005555",
  brightWhite: "#888888",
};

const LIGHT_THEME: TerminalTheme = {
  background: "#ffffff",
  foreground: "#bbbbbb",
  black: "#111111",
  red: "#770000",
  green: "#007700",
  yellow: "#777700",
  blue: "#000077",
  magenta: "#770077",
  cyan: "#007777",
  white: "#cccccc",
  brightBlack: "#333333",
  brightRed: "#990000",
  brightGreen: "#009900",
  brightYellow: "#999900",
  brightBlue: "#000099",
  brightMagenta: "#990099",
  brightCyan: "#009999",
  brightWhite: "#dddddd",
};

test("theme state keeps the latest minimum contrast ratio across theme changes", () => {
  const state = createTerminalThemeState(DARK_THEME, 1);

  const initialTheme = state.getCurrentTheme();
  assert.equal(initialTheme.foreground, "#333333");

  const highContrastDarkTheme = state.setMinimumContrastRatio(7);
  assert.notEqual(highContrastDarkTheme.foreground, "#333333");

  const highContrastLightTheme = state.setBaseTheme(LIGHT_THEME);
  assert.notEqual(highContrastLightTheme.foreground, "#bbbbbb");

  const repeatedLightTheme = state.getCurrentTheme();
  assert.deepEqual(repeatedLightTheme, highContrastLightTheme);
});
