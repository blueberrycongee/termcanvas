import test from "node:test";
import assert from "node:assert/strict";

type ThemeModule = typeof import("../src/stores/themeStore.ts");

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
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

async function loadThemeModule(): Promise<ThemeModule> {
  Object.assign(globalThis, {
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
    },
    document: {
      documentElement: {
        setAttribute: () => undefined,
      },
    },
  });

  return import("../src/stores/themeStore.ts");
}

test("light xterm grayscale palette preserves visible hierarchy for CLI roles", async () => {
  const { XTERM_THEMES } = await loadThemeModule();
  const light = XTERM_THEMES.light;

  assert.ok(
    contrastRatio(light.foreground!, light.white!) >= 3,
    `foreground ${light.foreground} and white ${light.white} should stay meaningfully separated`,
  );
  assert.ok(
    contrastRatio(light.black!, light.white!) >= 2,
    `black ${light.black} and white ${light.white} should not collapse into the same tone`,
  );
  assert.ok(
    contrastRatio(light.brightBlack!, light.brightWhite!) >= 2,
    `brightBlack ${light.brightBlack} and brightWhite ${light.brightWhite} should preserve a secondary hierarchy`,
  );
});
