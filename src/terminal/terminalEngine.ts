import type { TerminalTheme } from "./theme";
import { serializeBufferToText } from "./scrollbackSnapshot";
import { getSerializableBuffer } from "./scrollbackBuffer";
import { createTerminalThemeState } from "./themeState";
import { syncTerminalCursorBlink } from "./cursorBlink";

type GhosttyModule = typeof import("ghostty-web");
type GhosttyTerminal = import("ghostty-web").Terminal;

export type CompatibleTerminal = GhosttyTerminal;

export interface TerminalEngineSession {
  terminal: CompatibleTerminal;
  fit: () => void;
  serialize: () => string | null;
  applyTheme: (theme: TerminalTheme) => void;
  applyFontSize: (size: number) => void;
  applyFontFamily: (family: string) => void;
  applyMinimumContrastRatio: (ratio: number) => void;
  setCursorBlink: (enabled: boolean) => void;
  touch: () => void;
  dispose: () => void;
}

interface CreateTerminalEngineSessionOptions {
  container: HTMLElement;
  theme: TerminalTheme;
  fontFamily: string;
  fontSize: number;
  minimumContrastRatio: number;
  cursorBlink: boolean;
  scrollback?: string;
}

function rerenderTerminal(terminal: GhosttyTerminal) {
  if (terminal.renderer && terminal.wasmTerm) {
    terminal.renderer.render(
      terminal.wasmTerm,
      true,
      terminal.getViewportY(),
      terminal,
    );
  }
}

let ghosttyModulePromise: Promise<GhosttyModule> | null = null;

async function loadGhosttyModule(): Promise<GhosttyModule> {
  if (!ghosttyModulePromise) {
    ghosttyModulePromise = import("ghostty-web").then(async (mod) => {
      await mod.init();
      return mod;
    });
  }

  return ghosttyModulePromise;
}

async function createGhosttySession(
  options: CreateTerminalEngineSessionOptions,
): Promise<TerminalEngineSession> {
  const ghostty = await loadGhosttyModule();
  const themeState = createTerminalThemeState(
    options.theme,
    options.minimumContrastRatio,
  );
  let currentTheme = themeState.getCurrentTheme();
  const terminal = new ghostty.Terminal({
    theme: currentTheme,
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    cursorBlink: options.cursorBlink,
    cursorStyle: "bar",
    scrollback: 5000,
    allowTransparency: false,
  });

  const fitAddon = new ghostty.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(options.container);

  if (options.scrollback) {
    terminal.write(options.scrollback, () => terminal.scrollToBottom());
  }

  requestAnimationFrame(() => {
    fitAddon.fit();
  });

  return {
    terminal,
    fit: () => fitAddon.fit(),
    serialize: () => serializeBufferToText(getSerializableBuffer(terminal.buffer)),
    applyTheme: (theme) => {
      currentTheme = themeState.setBaseTheme(theme);
      terminal.renderer?.setTheme(currentTheme);
      rerenderTerminal(terminal);
    },
    applyFontSize: (size) => {
      if (terminal.options.fontSize !== size) {
        terminal.options.fontSize = size;
        fitAddon.fit();
      }
    },
    applyFontFamily: (family) => {
      if (terminal.options.fontFamily !== family) {
        terminal.options.fontFamily = family;
        fitAddon.fit();
      }
    },
    applyMinimumContrastRatio: (ratio) => {
      currentTheme = themeState.setMinimumContrastRatio(ratio);
      terminal.renderer?.setTheme(currentTheme);
      rerenderTerminal(terminal);
    },
    setCursorBlink: (enabled) => {
      syncTerminalCursorBlink(terminal, enabled);
    },
    touch: () => {
      // Ghostty manages its own renderer path.
    },
    dispose: () => {
      terminal.dispose();
    },
  };
}

export async function createTerminalEngineSession(
  options: CreateTerminalEngineSessionOptions,
): Promise<TerminalEngineSession> {
  return createGhosttySession(options);
}
