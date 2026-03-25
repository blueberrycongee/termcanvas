import type { TerminalTheme } from "./theme.ts";

export interface TerminalSessionBootstrapConfig {
  theme: TerminalTheme;
  fontFamily: string;
  fontSize: number;
  minimumContrastRatio: number;
  cursorBlink: boolean;
  scrollback?: string;
}

interface BuildTerminalSessionBootstrapConfigInput {
  theme: TerminalTheme;
  fontFamily: string;
  fontSize: number;
  minimumContrastRatio: number;
  scrollback?: string | null;
  focused: boolean;
}

export function buildTerminalSessionBootstrapConfig(
  input: BuildTerminalSessionBootstrapConfigInput,
): TerminalSessionBootstrapConfig {
  return {
    theme: input.theme,
    fontFamily: input.fontFamily,
    fontSize: input.fontSize,
    minimumContrastRatio: input.minimumContrastRatio,
    // Focus is applied after session bind so terminal focus changes never
    // invalidate the bootstrap config or force a renderer rebuild.
    cursorBlink: false,
    ...(input.scrollback ? { scrollback: input.scrollback } : {}),
  };
}
