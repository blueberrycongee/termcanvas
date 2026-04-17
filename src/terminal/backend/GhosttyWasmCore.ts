import type { Ghostty, GhosttyTerminal, GhosttyCell } from "ghostty-web";

export interface GhosttyWasmCoreOptions {
  cols: number;
  rows: number;
  scrollbackLimit?: number;
}

/**
 * Thin typed wrapper around ghostty-web's GhosttyTerminal. Exists to:
 *
 *  1. give the rest of TermCanvas a stable surface that does not leak
 *     ghostty-web type names outward,
 *  2. pre-declare the operations downstream code (backend, renderer, tests,
 *     benchmarks) will actually use,
 *  3. keep zero-alloc viewport reads intact — we hand back the array
 *     `getViewport()` returns without copying.
 *
 * Non-goals: input handling, rendering, selection. Those live in separate
 * modules so this wrapper stays testable in pure Node.
 */
export class GhosttyWasmCore {
  readonly #terminal: GhosttyTerminal;
  #disposed = false;

  constructor(ghostty: Ghostty, options: GhosttyWasmCoreOptions) {
    this.#terminal = ghostty.createTerminal(options.cols, options.rows, {
      scrollbackLimit: options.scrollbackLimit,
    });
  }

  get cols(): number {
    return this.#terminal.cols;
  }

  get rows(): number {
    return this.#terminal.rows;
  }

  /**
   * Feed parser bytes. Accepts a batched chunk — the WASM side copies it
   * across the boundary in one call regardless of length, so callers should
   * prefer larger writes over per-byte loops.
   */
  write(data: string | Uint8Array): void {
    this.assertAlive();
    this.#terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    this.assertAlive();
    this.#terminal.resize(cols, rows);
  }

  /**
   * Sync the renderer-facing state with the parser. Returns the new dirty
   * state (full / partial / none) reported by Ghostty.
   */
  update(): number {
    this.assertAlive();
    return this.#terminal.update();
  }

  /**
   * One-call viewport read. The returned array is reused across calls by the
   * underlying pool; callers that need to hold a snapshot must copy cells
   * they care about.
   */
  getViewport(): GhosttyCell[] {
    this.assertAlive();
    return this.#terminal.getViewport();
  }

  getLine(y: number): GhosttyCell[] | null {
    this.assertAlive();
    return this.#terminal.getLine(y);
  }

  getCursor() {
    this.assertAlive();
    return this.#terminal.getCursor();
  }

  getColors() {
    this.assertAlive();
    return this.#terminal.getColors();
  }

  // ghostty-web declares these as `boolean` but the WASM bridge returns 0/1
  // ints. Coerce so that downstream callers and tests can rely on real
  // booleans (`=== true` etc.).
  isRowDirty(y: number): boolean {
    this.assertAlive();
    return !!this.#terminal.isRowDirty(y);
  }

  needsFullRedraw(): boolean {
    this.assertAlive();
    return !!this.#terminal.needsFullRedraw();
  }

  markClean(): void {
    this.assertAlive();
    this.#terminal.markClean();
  }

  isAlternateScreen(): boolean {
    this.assertAlive();
    return !!this.#terminal.isAlternateScreen();
  }

  hasBracketedPaste(): boolean {
    this.assertAlive();
    return !!this.#terminal.hasBracketedPaste();
  }

  hasFocusEvents(): boolean {
    this.assertAlive();
    return !!this.#terminal.hasFocusEvents();
  }

  hasMouseTracking(): boolean {
    this.assertAlive();
    return !!this.#terminal.hasMouseTracking();
  }

  getMode(mode: number, isAnsi = false): boolean {
    this.assertAlive();
    return !!this.#terminal.getMode(mode, isAnsi);
  }

  hasResponse(): boolean {
    this.assertAlive();
    return !!this.#terminal.hasResponse();
  }

  readResponse(): string | null {
    this.assertAlive();
    return this.#terminal.readResponse();
  }

  getScrollbackLength(): number {
    this.assertAlive();
    return this.#terminal.getScrollbackLength();
  }

  getScrollbackLine(offset: number): GhosttyCell[] | null {
    this.assertAlive();
    return this.#terminal.getScrollbackLine(offset);
  }

  isRowWrapped(row: number): boolean {
    this.assertAlive();
    return this.#terminal.isRowWrapped(row);
  }

  getGraphemeString(row: number, col: number): string {
    this.assertAlive();
    return this.#terminal.getGraphemeString(row, col);
  }

  /**
   * Convenience: assemble viewport rows into plain strings for tests and
   * golden-output comparisons. Unwritten cells (codepoint 0) are rendered as
   * spaces, which is how a user would see them and matches xterm.js's
   * `translateToString` semantics, so tests can write expectations in
   * intuitive `"    X"` form rather than NUL-filled strings.
   */
  getViewportText(trimRight = true): string[] {
    this.assertAlive();
    this.#terminal.update();
    const lines: string[] = [];
    for (let y = 0; y < this.rows; y += 1) {
      let line = "";
      for (let x = 0; x < this.cols; x += 1) {
        const g = this.#terminal.getGraphemeString(y, x);
        line += g === "\0" || g === "" ? " " : g;
      }
      lines.push(trimRight ? line.replace(/\s+$/u, "") : line);
    }
    return lines;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#terminal.free();
  }

  private assertAlive(): void {
    if (this.#disposed) {
      throw new Error("GhosttyWasmCore used after dispose()");
    }
  }
}
