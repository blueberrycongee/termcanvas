import type { TerminalTheme } from "./theme";

function parseHexColor(color?: string): [number, number, number] | null {
  if (!color || !color.startsWith("#")) return null;
  const hex = color.slice(1);
  if (hex.length !== 6) return null;
  const value = Number.parseInt(hex, 16);
  if (Number.isNaN(value)) return null;
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(color: [number, number, number]): number {
  const [r, g, b] = color
    .map((channel) => channel / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
    );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: [number, number, number], background: [number, number, number]): number {
  const lumA = relativeLuminance(foreground);
  const lumB = relativeLuminance(background);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixChannel(a: number, b: number, amount: number): number {
  return Math.round(a + (b - a) * amount);
}

function ensureContrast(color: string | undefined, background: string | undefined, minRatio: number): string | undefined {
  if (!color || minRatio <= 1) return color;
  const fg = parseHexColor(color);
  const bg = parseHexColor(background);
  if (!fg || !bg) return color;
  if (contrastRatio(fg, bg) >= minRatio) return color;

  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  const target =
    contrastRatio(white, bg) >= contrastRatio(black, bg) ? white : black;

  let low = 0;
  let high = 1;
  let best = fg;
  for (let i = 0; i < 12; i++) {
    const amount = (low + high) / 2;
    const candidate: [number, number, number] = [
      mixChannel(fg[0], target[0], amount),
      mixChannel(fg[1], target[1], amount),
      mixChannel(fg[2], target[2], amount),
    ];
    if (contrastRatio(candidate, bg) >= minRatio) {
      best = candidate;
      high = amount;
    } else {
      low = amount;
    }
  }

  return toHex(best);
}

const CONTRAST_KEYS: Array<keyof TerminalTheme> = [
  "foreground",
  "cursor",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

export function applyMinimumContrastToTheme(
  theme: TerminalTheme,
  minimumContrastRatio: number,
): TerminalTheme {
  if (minimumContrastRatio <= 1) {
    return theme;
  }

  const adjusted: TerminalTheme = { ...theme };
  for (const key of CONTRAST_KEYS) {
    adjusted[key] = ensureContrast(theme[key], theme.background, minimumContrastRatio);
  }
  return adjusted;
}
