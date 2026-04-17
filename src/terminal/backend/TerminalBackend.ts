import type { ITheme } from "@xterm/xterm";

/**
 * The Terminal-like surface that TermCanvas's runtime store depends on. We
 * share this shape between the xterm.js implementation and the Ghostty WASM
 * implementation so the runtime store can hold either behind `runtime.xterm`
 * without a full refactor. Anything wider (pty spawn, CLI detection,
 * telemetry, session tracking) lives outside the backend and is identical
 * for both paths.
 *
 * This is deliberately not a 1:1 copy of xterm.js's Terminal type — we list
 * only the operations we actually use, so the Ghostty implementation has a
 * tractable target and the mock in tests stays a thin object.
 */
export interface CompatibleTerminal {
  readonly cols: number;
  readonly rows: number;
  /**
   * Runtime-tweakable options. Both backends expose at least theme,
   * fontFamily, fontSize, and minimumContrastRatio (Ghostty ignores the
   * last one; it's kept in the shape so callers don't fork).
   */
  options: {
    theme?: ITheme;
    fontFamily?: string;
    fontSize?: number;
    minimumContrastRatio?: number;
    cursorBlink?: boolean;
  };

  write(data: string | Uint8Array, callback?: () => void): void;
  focus(options?: { preventScroll?: boolean }): void;
  blur(): void;
  selectAll(): void;
  getSelection(): string;
  scrollToBottom(): void;
  dispose(): void;

  /**
   * Optional forced redraw. xterm.js uses (start, end) inclusive row
   * indices; Ghostty's backend accepts the call and triggers a full redraw.
   */
  refresh?(start: number, end: number): void;

  /**
   * Load an xterm.js addon. Only the xterm backend honours this; the
   * Ghostty backend keeps it as a no-op for drop-in compatibility.
   */
  loadAddon?(addon: unknown): void;

  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  onData(listener: (data: string) => void): TerminalDisposable;
  onResize(
    listener: (size: { cols: number; rows: number }) => void,
  ): TerminalDisposable;
  onSelectionChange(listener: () => void): TerminalDisposable;
}

export interface TerminalDisposable {
  dispose(): void;
}

/**
 * Identifier for which parser+renderer combination a runtime is using.
 * Exposed as a runtime preference so users can opt into the new backend
 * without us having to ship it as a full replacement on day one.
 */
export type TerminalBackendKind = "xterm" | "ghostty-wasm";

export const DEFAULT_TERMINAL_BACKEND: TerminalBackendKind = "xterm";

export function isTerminalBackendKind(
  value: unknown,
): value is TerminalBackendKind {
  return value === "xterm" || value === "ghostty-wasm";
}

export interface CreateBackendOptions {
  container: HTMLElement;
  cols?: number;
  rows?: number;
  scrollback?: number;
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
  minimumContrastRatio: number;
  cursorBlink: boolean;
}

/**
 * A backend owns the lifecycle of a terminal: creation, tearing down, and
 * producing a CompatibleTerminal handle that the rest of TermCanvas can
 * drive. Backends are constructed once per terminal tile — not once per
 * process — because their DOM hosts differ.
 *
 * The runtime store is still the canonical owner of the terminal; the
 * backend exposes `terminal` so the store can keep treating it the same way
 * it currently treats `runtime.xterm`.
 */
export interface TerminalBackend {
  readonly kind: TerminalBackendKind;
  readonly terminal: CompatibleTerminal;

  /**
   * The element that hosts the visible content. For xterm this is the
   * `.xterm` root; for Ghostty this is the canvas (or its wrapping div).
   * TerminalTile uses it for pointer-coordinate correction.
   */
  readonly hostElement: HTMLElement;

  /**
   * The innermost interactive surface. For xterm this is `.xterm-screen`;
   * for Ghostty this is the rendering canvas. Selection and pointer-rect
   * math anchors against this element, so both backends must return a
   * stable node that matches cell-grid geometry.
   */
  readonly screenElement: HTMLElement;

  /**
   * Resize the terminal to fill its container. Backends decide how:
   * the xterm backend runs FitAddon; the Ghostty backend measures font
   * metrics and sets cols/rows accordingly.
   */
  fit(): void;

  /**
   * Serialize the current screen (and scrollback, when the backend keeps
   * one) as an ANSI byte stream suitable for replay on a fresh backend of
   * the same kind. Returns null if the backend cannot produce a snapshot
   * (e.g. mid-teardown).
   */
  serialize(): string | null;
}
