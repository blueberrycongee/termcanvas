import type { ITheme } from "@xterm/xterm";
import {
  FitAddon as GhosttyFitAddon,
  Terminal as GhosttyTerminal,
  init as initGhosttyWeb,
} from "ghostty-web";

import { serializeGhosttyTerminal } from "./serializeGhostty.ts";
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
  private readonly forceFit: () => void;
  private readonly resizeObserver: ResizeObserver | null;
  private disposed = false;

  private constructor(
    ghosttyTerminal: GhosttyTerminal,
    fitAddon: GhosttyFitAddon,
    hostElement: HTMLElement,
    screenElement: HTMLElement,
    forceFit: () => void,
    resizeObserver: ResizeObserver | null,
  ) {
    this.ghosttyTerminal = ghosttyTerminal;
    this.fitAddon = fitAddon;
    this.hostElement = hostElement;
    this.screenElement = screenElement;
    this.forceFit = forceFit;
    this.resizeObserver = resizeObserver;
    this.terminal = adaptGhosttyTerminal(
      ghosttyTerminal,
      hostElement,
      () => {
        this.resizeObserver?.disconnect();
      },
    );
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

    // ghostty-web's Terminal.open unconditionally sets `contenteditable=true`
    // on the element it was opened into AND `Terminal.focus()` focuses that
    // same element (not the IME textarea sitting inside it). Result on
    // Chromium: keystrokes get inserted as DOM text nodes into the host div
    // — you can literally watch "claude" show up as live text between the
    // canvas and the host's edge. The beforeinput listener ghostty-web
    // installs to suppress that insertion doesn't always fire in Electron.
    //
    // Strip the contenteditable attribute so the host is no longer a text
    // sink. IME still flows because the real input target is the textarea
    // ghostty-web creates as a sibling of the canvas, and the composition
    // events fire on that textarea regardless of the host's state.
    options.container.removeAttribute("contenteditable");
    options.container.removeAttribute("role");
    options.container.removeAttribute("aria-multiline");

    // ghostty-web parks its IME textarea at (0,0) with opacity:0 + clipPath,
    // intending for it to be invisible. Chromium on Electron renders the
    // native text caret outside the opacity stack, so the caret leaks
    // through as a blinking bar in the top-left of the tile. Kill it
    // explicitly — caret-color doesn't affect the terminal's drawn cursor
    // (that's painted on the canvas), only the textarea's own.
    const textarea = options.container.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.style.caretColor = "transparent";
    }

    // ghostty-web's canvas is always sized to an integer number of cells
    // (cols × charWidth × rows × charHeight). Whatever doesn't fit in an
    // integer number of cells stays as a bare strip of host background on
    // the right/bottom of the tile. Paint the host background with the
    // terminal's background colour so that remainder strip is visually
    // continuous with the canvas.
    if (options.theme?.background) {
      options.container.style.backgroundColor = options.theme.background;
    }

    const fitAddon = new GhosttyFitAddon();
    term.loadAddon(fitAddon);
    // ghostty-web sizes its canvas strictly to cols×charWidth × rows×charHeight
    // — it does NOT auto-fill the parent. ghostty-web's own FitAddon.fit
    // short-circuits when the container's clientWidth is 0 (which it often is
    // during the same microtask Terminal.open() runs in), and its
    // observeResize ResizeObserver has a 100 ms debounce that gets reset by
    // React Flow's layout churn — together they can leave the canvas stuck
    // at the default 80×24 long enough that the user sees a "tiny terminal
    // parked in the top-left" before anything corrects it.
    //
    // Bypass both: take the measurement ourselves from the host element on
    // the next two frame boundaries, and drive `term.resize()` directly so
    // the initial sizing is correct regardless of what the fit plugin or
    // its observer do.
    const forceFit = () => {
      const rect = options.container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const renderer = (term as unknown as {
        renderer?: { getMetrics?: () => { width: number; height: number } };
      }).renderer;
      const metrics = renderer?.getMetrics?.();
      if (!metrics || metrics.width <= 0 || metrics.height <= 0) return;
      // Ghostty-web's canvas renderer paints its own scrollbar *inside* the
      // canvas, so — unlike xterm.js's WebGL canvas — we don't need to
      // reserve any extra pixels on the right. Claiming the full width
      // squeezes one more column of real estate out of the tile and keeps
      // the remainder strip (from sub-cell fractions) as small as possible.
      const cols = Math.max(2, Math.floor(rect.width / metrics.width));
      const rows = Math.max(2, Math.floor(rect.height / metrics.height));
      if (cols === term.cols && rows === term.rows) return;
      term.resize(cols, rows);
    };
    // Attach our OWN ResizeObserver instead of fitAddon.observeResize. The
    // plugin's observer runs fit() through a 100 ms debounce plus a 50 ms
    // `_isResizing` latch, and in practice both can swallow the initial
    // fire on React Flow-backed tiles — the user sees a small canvas
    // parked in the top-left until they manually drag the tile to a new
    // size. A bare observer driving our own forceFit has no debounce and
    // no latch, so every layout change (including the first one after
    // mount) routes straight to a resize.
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => forceFit());
      resizeObserver.observe(options.container);
    }
    // The observer fires once on .observe() with the element's current size,
    // but only after layout settles. Cover the window before that first
    // callback with a scheduled sweep so the first paint isn't a tiny
    // default-sized canvas.
    forceFit();
    requestAnimationFrame(() => {
      forceFit();
      setTimeout(forceFit, 50);
      setTimeout(forceFit, 200);
    });

    // ghostty-web paints onto a canvas inside the container. Treat the
    // container as the host and the canvas as the screen element so
    // coordinate correction in TerminalTile anchors against the actual
    // rendered surface.
    const hostElement = options.container;
    const screenElement =
      (options.container.querySelector("canvas") as HTMLElement | null) ??
      options.container;

    return new GhosttyWasmBackend(
      term,
      fitAddon,
      hostElement,
      screenElement,
      forceFit,
      resizeObserver,
    );
  }

  fit(): void {
    if (this.disposed) return;
    // Use our own measurement path (the same one our ResizeObserver drives)
    // rather than the plugin's fit. The plugin's fit has been observed to
    // short-circuit early in the tile's lifetime (see the observer rationale
    // in create()).
    this.forceFit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.ghosttyTerminal.dispose();
  }

  serialize(): string | null {
    if (this.disposed) return null;
    const wasmTerm = this.ghosttyTerminal.wasmTerm;
    if (!wasmTerm) return null;
    try {
      return serializeGhosttyTerminal(wasmTerm);
    } catch (error) {
      console.error("[ghostty-wasm] serialize failed:", error);
      return null;
    }
  }
}

/**
 * Wrap ghostty-web's `Terminal` in the structural subset that TermCanvas
 * depends on. This is a thin facade: delegate everything, normalise a few
 * shape differences with xterm.js (the no-op `refresh`, a tolerant
 * `loadAddon`, coerced `options` getters/setters).
 */
function adaptGhosttyTerminal(
  term: GhosttyTerminal,
  hostElement: HTMLElement,
  onDispose?: () => void,
): CompatibleTerminal {
  const optionsProxy: CompatibleTerminal["options"] = {
    get theme() {
      return term.options.theme as ITheme | undefined;
    },
    set theme(value: ITheme | undefined) {
      if (!value) return;

      // HACK (not the long-term plan): ghostty-web v0.4.0's own
      // Terminal.handleOptionChange does nothing for "theme" beyond
      // logging `theme changes after open() are not yet fully supported`.
      // Setting term.options.theme alone leaves the canvas frozen on the
      // old palette — the user sees the host switch between light/dark
      // while the terminal content stays in the previous theme.
      //
      // Reach past the public API into the CanvasRenderer to rebuild the
      // palette and force a full redraw. Keep term.options.theme assigned
      // too so future ghostty-web versions that implement the option
      // handler see the right value. This workaround goes away when we
      // replace ghostty-web's renderer with our own — see the PR for the
      // follow-up plan.
      term.options.theme = value;

      const internals = term as unknown as {
        renderer?: {
          setTheme?: (theme: ITheme) => void;
          render?: (
            buffer: unknown,
            forceAll: boolean,
            viewportY: number,
            scrollback: unknown,
            scrollbarOpacity: number,
          ) => void;
        };
        wasmTerm?: unknown;
        viewportY?: number;
      };

      internals.renderer?.setTheme?.(value);
      if (internals.renderer?.render && internals.wasmTerm) {
        internals.renderer.render(
          internals.wasmTerm,
          true,
          internals.viewportY ?? 0,
          term,
          0,
        );
      }

      // Keep the host's background colour in sync so the sub-cell remainder
      // strip between the canvas and the host's edges blends into the theme
      // instead of showing the app's generic surface colour through it.
      if (value.background) {
        hostElement.style.backgroundColor = value.background;
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
      // ghostty-web's default Terminal.focus() focuses `this.element` (the
      // host div), which is the wrong target — the host is either
      // contenteditable (capturing key input as DOM text) or merely
      // tabindex=0 (not producing beforeinput/IME events at all). The
      // *real* input target is the hidden IME textarea, which is where
      // ghostty-web's InputHandler expects key and composition events to
      // flow from. Focus it directly so typing reaches the terminal.
      const textarea = (term as unknown as {
        textarea?: HTMLTextAreaElement;
      }).textarea;
      if (textarea) {
        textarea.focus();
      } else {
        term.focus();
      }
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
      onDispose?.();
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
      // xterm.js and ghostty-web have OPPOSITE semantics for this return
      // value. xterm reads `true` as "xterm should process this key"; the
      // whole of TermCanvas speaks that dialect. ghostty-web (see
      // InputHandler.handleKeyDown in the bundled source) reads `true` as
      // "skip processing, preventDefault()". Feed the caller's xterm-style
      // return value through a negation so the handler keeps working when
      // we swap backends.
      term.attachCustomKeyEventHandler((event) => !handler(event));
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
