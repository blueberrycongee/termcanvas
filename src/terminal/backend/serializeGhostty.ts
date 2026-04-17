import type { GhosttyCell, GhosttyTerminal } from "ghostty-web";

/**
 * Produce an ANSI byte stream that reproduces the current screen state of
 * a `GhosttyTerminal` when written back to any VT parser. Matches what
 * `@xterm/addon-serialize` gives us for the xterm backend in shape, so
 * TermCanvas's scrollback-save/restore path can use either backend behind
 * the same contract.
 *
 * Scope:
 *  - scrollback buffer (oldest → newest)
 *  - active screen viewport (row 0 → rows-1)
 *  - SGR style deltas between cells (truecolor fg/bg, bold, italic,
 *    underline, strikethrough, inverse, faint)
 *  - wide-char handling (skip follower cells, emit full grapheme string)
 *  - `\x1b[0m` reset at the very end so a reader can re-enter a clean
 *    state before writing fresh PTY output on top
 *
 * Deliberately out of scope for v1: cursor restoration, OSC 8 hyperlink
 * round-trip, alt-screen content, exact preservation of soft line wraps
 * (they re-wrap when replayed at a new width). Those are follow-ups.
 */
export function serializeGhosttyTerminal(term: GhosttyTerminal): string {
  // Ensure render state is fresh before we read it.
  term.update();

  const out: string[] = [];
  const state: StyleState = resetStyleState();

  const scrollbackLen = term.getScrollbackLength();
  for (let offset = 0; offset < scrollbackLen; offset += 1) {
    const line = term.getScrollbackLine(offset);
    if (!line) continue;
    emitLine(term, line, offset, true, state, out);
    out.push("\r\n");
  }

  const { rows, cols } = term.getDimensions();
  const viewport = term.getViewport();
  for (let y = 0; y < rows; y += 1) {
    const line = viewport.slice(y * cols, (y + 1) * cols);
    emitLine(term, line, y, false, state, out);
    if (y < rows - 1) out.push("\r\n");
  }

  out.push("\x1b[0m");
  return out.join("");
}

interface StyleState {
  /** null means "default (no colour override emitted yet)" */
  fg: [number, number, number] | null;
  bg: [number, number, number] | null;
  flags: number;
}

function resetStyleState(): StyleState {
  return { fg: null, bg: null, flags: 0 };
}

/** CellFlags bits — mirrored from ghostty-web's enum, kept local so the
 * serializer doesn't reach into ghostty-web internals. */
const FLAG_BOLD = 1;
const FLAG_ITALIC = 2;
const FLAG_UNDERLINE = 4;
const FLAG_STRIKETHROUGH = 8;
const FLAG_INVERSE = 16;
const FLAG_FAINT = 128;
const STYLE_FLAG_MASK =
  FLAG_BOLD |
  FLAG_ITALIC |
  FLAG_UNDERLINE |
  FLAG_STRIKETHROUGH |
  FLAG_INVERSE |
  FLAG_FAINT;

function emitLine(
  term: GhosttyTerminal,
  line: GhosttyCell[],
  lineIndex: number,
  isScrollback: boolean,
  state: StyleState,
  out: string[],
): void {
  const lastNonEmpty = findLastNonEmpty(line);

  for (let x = 0; x <= lastNonEmpty; x += 1) {
    const cell = line[x];
    if (!cell) continue;
    if (cell.width === 0) {
      // Follower cell of a wide char — the base cell already emitted the
      // grapheme string. Skipping keeps the output width-correct.
      continue;
    }
    applyStyle(cell, state, out);
    const grapheme = isScrollback
      ? term.getScrollbackGraphemeString(lineIndex, x)
      : term.getGraphemeString(lineIndex, x);
    out.push(renderGrapheme(grapheme));
  }
}

/**
 * Find the index of the last cell on this line that has non-default
 * content. We trim trailing "empty" cells so replayed output matches what
 * a user would see, not the raw grid padding.
 */
function findLastNonEmpty(line: GhosttyCell[]): number {
  for (let x = line.length - 1; x >= 0; x -= 1) {
    const cell = line[x];
    if (!cell) continue;
    if (cell.codepoint !== 0) return x;
    // A cell can be "empty" but still carry a non-default background.
    if (cell.bg_r !== 0 || cell.bg_g !== 0 || cell.bg_b !== 0) return x;
  }
  return -1;
}

/** Translate null/empty grapheme output into a space so the consumer sees
 * a rendered glyph rather than a control char. */
function renderGrapheme(g: string): string {
  if (g === "" || g === "\0") return " ";
  return g;
}

function applyStyle(cell: GhosttyCell, state: StyleState, out: string[]): void {
  const cellFg: [number, number, number] = [cell.fg_r, cell.fg_g, cell.fg_b];
  const cellBg: [number, number, number] = [cell.bg_r, cell.bg_g, cell.bg_b];
  const cellFlags = cell.flags & STYLE_FLAG_MASK;

  const fgChanged = !sameColor(state.fg, cellFg);
  const bgChanged = !sameColor(state.bg, cellBg);
  const flagsChanged = cellFlags !== state.flags;

  if (!fgChanged && !bgChanged && !flagsChanged) return;

  // If flags shrank, the safest cross-terminal way to drop them is a full
  // reset followed by re-emitting whatever we still want on. Incremental
  // disable sequences (e.g. ESC[22m to drop bold) are supported but the
  // reset-and-replay path is strictly smaller to reason about and the
  // extra bytes are noise compared to the cell content.
  const removingFlags = (state.flags & ~cellFlags) !== 0;
  const removingFg = state.fg !== null && isDefault(cellFg);
  const removingBg = state.bg !== null && isDefault(cellBg);

  if (removingFlags || removingFg || removingBg) {
    out.push("\x1b[0m");
    state.fg = null;
    state.bg = null;
    state.flags = 0;
  }

  if (cellFlags !== state.flags) {
    if (cellFlags & FLAG_BOLD) out.push("\x1b[1m");
    if (cellFlags & FLAG_FAINT) out.push("\x1b[2m");
    if (cellFlags & FLAG_ITALIC) out.push("\x1b[3m");
    if (cellFlags & FLAG_UNDERLINE) out.push("\x1b[4m");
    if (cellFlags & FLAG_INVERSE) out.push("\x1b[7m");
    if (cellFlags & FLAG_STRIKETHROUGH) out.push("\x1b[9m");
    state.flags = cellFlags;
  }

  if (!isDefault(cellFg) && !sameColor(state.fg, cellFg)) {
    out.push(`\x1b[38;2;${cellFg[0]};${cellFg[1]};${cellFg[2]}m`);
    state.fg = cellFg;
  }
  if (!isDefault(cellBg) && !sameColor(state.bg, cellBg)) {
    out.push(`\x1b[48;2;${cellBg[0]};${cellBg[1]};${cellBg[2]}m`);
    state.bg = cellBg;
  }
}

function sameColor(
  a: [number, number, number] | null,
  b: [number, number, number] | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function isDefault(color: [number, number, number]): boolean {
  // Ghostty reports (0,0,0) for cells that inherited the default colour
  // rather than an explicit truecolor SGR. Replaying with the default
  // rather than a hard-coded black preserves theme changes on the reader.
  return color[0] === 0 && color[1] === 0 && color[2] === 0;
}
