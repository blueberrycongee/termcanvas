import type { TerminalBackend } from "../types/index.ts";
import type { TerminalTheme } from "./theme";
import { serializeBufferToText } from "./scrollbackSnapshot";
import { getSerializableBuffer } from "./scrollbackBuffer";
import { createTerminalThemeState } from "./themeState";
import { syncTerminalCursorBlink } from "./cursorBlink";
import {
  acquireWebGL,
  releaseWebGL,
  touch as touchWebGL,
} from "./webglContextPool";

type GhosttyModule = typeof import("ghostty-web");
type GhosttyTerminal = import("ghostty-web").Terminal;
type XTermModule = typeof import("@xterm/xterm");
type XTermTerminal = import("@xterm/xterm").Terminal;
type FitAddonModule = typeof import("@xterm/addon-fit");
type SerializeAddonModule = typeof import("@xterm/addon-serialize");
type ImageAddonModule = typeof import("@xterm/addon-image");

interface TerminalDisposable {
  dispose: () => void;
}

interface TerminalOptionsShape {
  cursorBlink?: boolean;
  fontFamily?: string;
  fontSize?: number;
  minimumContrastRatio?: number;
  theme?: TerminalTheme;
}

interface CompatibleTerminalWrite {
  (data: string): void;
  (data: string, callback: () => void): void;
}

export interface CompatibleTerminal {
  cols: number;
  rows: number;
  options: TerminalOptionsShape;
  focus: (options?: { preventScroll?: boolean }) => void;
  write: CompatibleTerminalWrite;
  dispose: () => void;
  attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => void;
  onSelectionChange: (listener: () => void) => TerminalDisposable;
  getSelection: () => string;
  onData: (listener: (data: string) => void) => TerminalDisposable;
  onResize: (listener: (size: { cols: number; rows: number }) => void) => TerminalDisposable;
  scrollToBottom?: () => void;
  textarea?: GhosttyTerminal["textarea"];
  renderer?: GhosttyTerminal["renderer"];
  wasmTerm?: GhosttyTerminal["wasmTerm"];
  getViewportY?: GhosttyTerminal["getViewportY"];
}

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
  backend: TerminalBackend;
  terminalId: string;
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
let xtermModulePromise: Promise<{
  Terminal: XTermModule["Terminal"];
  FitAddon: FitAddonModule["FitAddon"];
  SerializeAddon: SerializeAddonModule["SerializeAddon"];
  ImageAddon: ImageAddonModule["ImageAddon"];
}> | null = null;

async function loadGhosttyModule(): Promise<GhosttyModule> {
  if (!ghosttyModulePromise) {
    ghosttyModulePromise = import("ghostty-web").then(async (mod) => {
      await mod.init();
      return mod;
    });
  }

  return ghosttyModulePromise;
}

async function loadXtermModules(): Promise<{
  Terminal: XTermModule["Terminal"];
  FitAddon: FitAddonModule["FitAddon"];
  SerializeAddon: SerializeAddonModule["SerializeAddon"];
  ImageAddon: ImageAddonModule["ImageAddon"];
}> {
  if (!xtermModulePromise) {
    xtermModulePromise = Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-serialize"),
      import("@xterm/addon-image"),
    ]).then(([xterm, fit, serialize, image]) => ({
      Terminal: xterm.Terminal,
      FitAddon: fit.FitAddon,
      SerializeAddon: serialize.SerializeAddon,
      ImageAddon: image.ImageAddon,
    }));
  }

  return xtermModulePromise;
}

async function createGhosttySession(
  options: CreateTerminalEngineSessionOptions,
): Promise<TerminalEngineSession> {
  const ghostty = await loadGhosttyModule();
  options.container.replaceChildren();
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

async function createXtermSession(
  options: CreateTerminalEngineSessionOptions,
): Promise<TerminalEngineSession> {
  const { Terminal, FitAddon, SerializeAddon, ImageAddon } =
    await loadXtermModules();
  options.container.replaceChildren();
  const terminal = new Terminal({
    theme: options.theme,
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    minimumContrastRatio: options.minimumContrastRatio,
    cursorBlink: options.cursorBlink,
    cursorStyle: "bar",
    scrollback: 5000,
    allowTransparency: false,
  });
  const fitAddon = new FitAddon();
  const serializeAddon = new SerializeAddon();

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(serializeAddon);

  try {
    terminal.loadAddon(new ImageAddon());
  } catch {
    // Optional enhancement only.
  }

  terminal.open(options.container);
  acquireWebGL(options.terminalId, terminal);

  if (options.scrollback) {
    terminal.write(options.scrollback, () => terminal.scrollToBottom());
  }

  requestAnimationFrame(() => {
    fitAddon.fit();
  });

  return {
    terminal,
    fit: () => fitAddon.fit(),
    serialize: () => serializeAddon.serialize(),
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
    applyMinimumContrastRatio: (ratio) => {
      if (terminal.options.minimumContrastRatio !== ratio) {
        terminal.options.minimumContrastRatio = ratio;
      }
    },
    setCursorBlink: (enabled) => {
      terminal.options.cursorBlink = enabled;
    },
    touch: () => {
      touchWebGL(options.terminalId);
    },
    dispose: () => {
      releaseWebGL(options.terminalId);
      terminal.dispose();
    },
  };
}

export async function createTerminalEngineSession(
  options: CreateTerminalEngineSessionOptions,
): Promise<TerminalEngineSession> {
  if (options.backend === "xterm") {
    return createXtermSession(options);
  }

  return createGhosttySession(options);
}
