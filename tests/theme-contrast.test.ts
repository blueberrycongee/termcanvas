import test from "node:test";
import assert from "node:assert/strict";

import { applyMinimumContrastToTheme } from "../src/terminal/themeContrast.ts";

function hexToRelativeLuminance(hex: string): number {
  const [r, g, b] = hex
    .match(/[0-9a-f]{2}/gi)!
    .map((part) => parseInt(part, 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
    );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const lumA = hexToRelativeLuminance(a);
  const lumB = hexToRelativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

test("applyMinimumContrastToTheme lifts terminal colors above the requested ratio", () => {
  const adjusted = applyMinimumContrastToTheme(
    {
      background: "#1a1918",
      foreground: "#333231",
      brightBlack: "#3a3836",
    },
    4.5,
  );

  assert.ok(adjusted.foreground);
  assert.ok(adjusted.brightBlack);
  assert.ok(contrastRatio(adjusted.foreground!, adjusted.background!) >= 4.5);
  assert.ok(contrastRatio(adjusted.brightBlack!, adjusted.background!) >= 4.5);
});
