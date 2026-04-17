import type { ITheme } from "@xterm/xterm";
import {
  FitAddon as GhosttyFitAddon,
  Terminal as GhosttyTerminal,
  init as initGhosttyWeb,
} from "ghostty-web";

import type {
  CompatibleTerminal,
  CreateBackendOptions,
  TerminalBackend,
  TerminalDisposable,
} from "./TerminalBackend.ts";

/**
 * One-time bootstrap of the ghostty-web WASM module. Terminal instances
 * share the compiled WASM, so we only pay the parse cost once per renderer
 * process. Callers that instantiate the backend during React's strict-mode
 * double-invocation phase will correctly reuse the same promise.
 */
let ghosttyInitPromise: Promise<void> | null = null;
function ensureGhosttyWebReady(): Promise<void> {
  if (!ghosttyInitPromise) {
    ghosttyInitPromise = initGhosttyWeb();
  }
  return ghosttyInitPromise;
}

export interface GhosttyWasmBackendConstructor {
  create(options: CreateBackendOptions): Promise<GhosttyWasmBackend>;
}

/**
 * Backend that drives terminal rendering through Ghostty's VT parser +
 * ghostty-web's Canvas renderer. Exposes a CompatibleTerminal with the
 * subset of the xterm.js surface that TermCanvas's runtime store actually
 * uses, so callers can hold either backend behind `runtime.xterm`.
 *
 * Rendering-layer choice (Canvas2D for now vs. a future WebGL2 swap) is
 * hidden behind this class — upgrading later does not change the backend
 * API.
 */
export class GhosttyWasmBackend implements TerminalBackend {
  readonly kind = "ghostty-wasm" as const;
  readonly terminal: CompatibleTerminal;
  readonly hostElement: HTMLElement;
  readonly screenElement: HTMLElement;

  private readonly ghosttyTerminal: GhosttyTerminal;
  private readonly fitAddon: GhosttyFitAddon;
  private disposed = false;

  private constructor(
    ghosttyTerminal: GhosttyTerminal,
    fitAddon: GhosttyFitAddon,
    hostElement: HTMLElement,
    screenElement: HTMLElement,
  ) {
    this.ghosttyTerminal = ghosttyTerminal;
    this.fitAddon = fitAddon;
    this.hostElement = hostElement;
    this.screenElement = screenElement;
    this.terminal = adaptGhosttyTerminal(ghosttyTerminal);
  }

  static async create(
    options: CreateBackendOptions,
  ): Promise<GhosttyWasmBackend> {
    await ensureGhosttyWebReady();

    const term = new GhosttyTerminal({
      cursorBlink: options.cursorBlink,
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
      theme: options.theme,
      scrollback: options.scrollback,
      cols: options.cols,
      rows: options.rows,
    });

    // Clear any previous contents — ghostty-web paints its canvas as a child
    // of the container, and React may have left stale nodes in place when
    // remounting a terminal tile at a different geometry.
    options.container.replaceChildren();
    term.open(options.container);

    const fitAddon = new GhosttyFitAddon();
    term.loadAddon(fitAddon);

    // ghostty-web paints onto a canvas inside the container. Treat the
    // container as the host and the canvas as the screen element so
    // coordinate correction in TerminalTile anchors against the actual
    // rendered surface.
    const hostElement = options.container;
    const screenElement =
      (options.container.querySelector("canvas") as HTMLElement | null) ??
      options.container;

    return new GhosttyWasmBackend(term, fitAddon, hostElement, screenElement);
  }

  fit(): void {
    if (this.disposed) return;
    this.fitAddon.fit();
  }

  serialize(): string | null {
    if (this.disposed) return null;
    // TODO(ghostty-wasm): translate wasmTerm's scrollback + active screen
    // into ANSI to match SerializeAddon output. Returning null is correct
    // for now — it tells the runtime store to fall back to its pre-existing
    // ANSI preview buffer, which is still written by the PTY stream.
    return null;
  }
}

/**
 * Wrap ghostty-web's `Terminal` in the structural subset that TermCanvas
 * depends on. This is a thin facade: delegate everything, normalise a few
 * shape differences with xterm.js (the no-op `refresh`, a tolerant
 * `loadAddon`, coerced `options` getters/setters).
 */
function adaptGhosttyTerminal(term: GhosttyTerminal): CompatibleTerminal {
  const optionsProxy: CompatibleTerminal["options"] = {
    get theme() {
      return term.options.theme as ITheme | undefined;
    },
    set theme(value: ITheme | undefined) {
      if (value) {
        term.options.theme = value;
      }
    },
    get fontFamily() {
      return term.options.fontFamily;
    },
    set fontFamily(value: string | undefined) {
      if (typeof value === "string") {
        term.options.fontFamily = value;
      }
    },
    get fontSize() {
      return term.options.fontSize;
    },
    set fontSize(value: number | undefined) {
      if (typeof value === "number") {
        term.options.fontSize = value;
      }
    },
    // ghostty-web has no `minimumContrastRatio` — it derives cell colours
    // from the theme directly. Accept the setter and silently drop so the
    // runtime store's existing subscription code doesn't fork.
    get minimumContrastRatio() {
      return undefined;
    },
    set minimumContrastRatio(_value: number | undefined) {
      /* no-op */
    },
    get cursorBlink() {
      return term.options.cursorBlink;
    },
    set cursorBlink(value: boolean | undefined) {
      if (typeof value === "boolean") {
        term.options.cursorBlink = value;
      }
    },
  };

  return {
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
    options: optionsProxy,
    write(data, callback) {
      term.write(data, callback);
    },
    focus(options) {
      // xterm's focus takes { preventScroll }; ghostty-web's focus ignores
      // args. Calling blur/focus keeps scroll stable enough for now.
      void options;
      term.focus();
    },
    blur() {
      term.blur();
    },
    selectAll() {
      term.selectAll();
    },
    getSelection() {
      return term.getSelection();
    },
    scrollToBottom() {
      term.scrollToBottom();
    },
    dispose() {
      term.dispose();
    },
    refresh(_start, _end) {
      // ghostty-web runs its own render loop off the dirty state reported
      // by the WASM layer, so an explicit refresh request is redundant.
      void _start;
      void _end;
    },
    loadAddon(_addon) {
      // Dropping xterm.js addons on the floor is intentional — they reach
      // into xterm.js internals and would throw. Callers that need an
      // addon-equivalent for the Ghostty backend should use this backend's
      // own mechanisms (e.g. `serialize()` instead of SerializeAddon).
      void _addon;
    },
    attachCustomKeyEventHandler(handler) {
      term.attachCustomKeyEventHandler(handler);
    },
    onData(listener): TerminalDisposable {
      return term.onData(listener);
    },
    onResize(listener): TerminalDisposable {
      return term.onResize(listener);
    },
    onSelectionChange(listener): TerminalDisposable {
      return term.onSelectionChange(listener);
    },
  };
}
