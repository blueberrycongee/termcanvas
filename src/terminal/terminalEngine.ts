import type { ITheme, Terminal as XtermTerminal } from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import { FitAddon as XtermFitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { ImageAddon } from "@xterm/addon-image";
import { acquireWebGL, releaseWebGL, touch as touchWebGL } from "./webglContextPool";

import type { TerminalRenderer } from "../stores/preferencesStore";

type GhosttyModule = typeof import("ghostty-web");
type GhosttyTerminal = import("ghostty-web").Terminal;

export type CompatibleTerminal = XtermTerminal | GhosttyTerminal;

export interface TerminalEngineSession {
  renderer: TerminalRenderer;
  terminal: CompatibleTerminal;
  fit: () => void;
  serialize: () => string | null;
  applyTheme: (theme: ITheme) => void;
  applyFontSize: (size: number) => void;
  applyFontFamily: (family: string) => void;
  applyMinimumContrastRatio: (ratio: number) => void;
  touch: () => void;
  dispose: () => void;
}

interface CreateTerminalEngineSessionOptions {
  renderer: TerminalRenderer;
  terminalId: string;
  container: HTMLElement;
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
  minimumContrastRatio: number;
  scrollback?: string;
}

interface XtermBufferService {
  isUserScrolling?: boolean;
}

interface XtermWithBufferService extends XtermTerminal {
  _core?: {
    _bufferService?: XtermBufferService;
  };
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

function createXtermSession(
  options: CreateTerminalEngineSessionOptions,
): TerminalEngineSession {
  const terminal = new Terminal({
    theme: options.theme,
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    lineHeight: 1.4,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    scrollback: 5000,
    minimumContrastRatio: options.minimumContrastRatio,
    allowTransparency: false,
  });

  const fitAddon = new XtermFitAddon();
  const serializeAddon = new SerializeAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(serializeAddon);
  terminal.open(options.container);

  // xterm can get stuck at the top of the viewport after scrollback trimming.
  const bufferService = (terminal as XtermWithBufferService)._core?._bufferService;
  const scrollDisposable = terminal.onScroll(() => {
    if (
      bufferService?.isUserScrolling &&
      terminal.buffer.active.viewportY === 0 &&
      terminal.buffer.active.baseY > terminal.rows
    ) {
      bufferService.isUserScrolling = false;
      terminal.scrollToBottom();
    }
  });

  acquireWebGL(options.terminalId, terminal);

  try {
    terminal.loadAddon(new ImageAddon());
  } catch {
    // Inline image support is optional.
  }

  terminal.options.theme = options.theme;

  if (options.scrollback) {
    terminal.write(options.scrollback, () => terminal.scrollToBottom());
  }

  requestAnimationFrame(() => {
    fitAddon.fit();
    terminal.refresh(0, terminal.rows - 1);
  });

  return {
    renderer: "xterm",
    terminal,
    fit: () => fitAddon.fit(),
    serialize: () => serializeAddon.serialize(),
    applyTheme: (theme) => {
      terminal.options.theme = theme;
      terminal.refresh(0, terminal.rows - 1);
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
      if (terminal.options.minimumContrastRatio !== ratio) {
        terminal.options.minimumContrastRatio = ratio;
        terminal.refresh(0, terminal.rows - 1);
      }
    },
    touch: () => {
      touchWebGL(options.terminalId);
    },
    dispose: () => {
      scrollDisposable.dispose();
      releaseWebGL(options.terminalId);
      terminal.dispose();
    },
  };
}

async function createGhosttySession(
  options: CreateTerminalEngineSessionOptions,
): Promise<TerminalEngineSession> {
  const ghostty = await loadGhosttyModule();
  const terminal = new ghostty.Terminal({
    theme: options.theme,
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 5000,
    allowTransparency: false,
  });

  const fitAddon = new ghostty.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(options.container);

  requestAnimationFrame(() => {
    fitAddon.fit();
  });

  return {
    renderer: "ghostty",
    terminal,
    fit: () => fitAddon.fit(),
    serialize: () => null,
    applyTheme: (theme) => {
      terminal.options.theme = theme;
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
    applyMinimumContrastRatio: () => {
      // ghostty-web does not expose minimumContrastRatio.
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
  if (options.renderer === "ghostty") {
    return createGhosttySession(options);
  }

  return createXtermSession(options);
}
