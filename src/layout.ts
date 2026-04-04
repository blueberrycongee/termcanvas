import { useTileDimensionsStore } from "./stores/tileDimensionsStore";

export const TERMINAL_W = 640;
export const TERMINAL_H = 480;
export const GRID_GAP = 8;

export const WT_PAD = 10;
export const WT_TITLE_H = 36;
export const WT_MIN_W = 300;
export const WT_EMPTY_BODY_H = 60;

export const PROJ_PAD = 12;
export const PROJ_TITLE_H = 40;

export const DEFAULT_GRID_COLS = 3;

export interface TileDims {
  w: number;
  h: number;
}

export function getDefaultTileDims(): TileDims {
  return useTileDimensionsStore.getState();
}

export interface TerminalSpan {
  cols: number;
  rows: number;
}

export interface PackedTerminal {
  index: number;
  col: number;
  row: number;
  span: TerminalSpan;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Bin-packing layout: place terminals into a grid respecting their spans.
 * Returns position and pixel size for each terminal.
 */
export function packTerminals(
  spans: TerminalSpan[],
  gridCols: number = DEFAULT_GRID_COLS,
  tileDims: TileDims = getDefaultTileDims(),
): PackedTerminal[] {
  if (spans.length === 0) return [];

  const tileW = tileDims.w;
  const tileH = tileDims.h;

  const occupied: boolean[][] = [];

  function isOccupied(r: number, c: number): boolean {
    return !!occupied[r]?.[c];
  }

  function markOccupied(
    r: number,
    c: number,
    spanCols: number,
    spanRows: number,
  ) {
    for (let dr = 0; dr < spanRows; dr++) {
      for (let dc = 0; dc < spanCols; dc++) {
        if (!occupied[r + dr]) occupied[r + dr] = [];
        occupied[r + dr][c + dc] = true;
      }
    }
  }

  function findPosition(
    spanCols: number,
    spanRows: number,
  ): { col: number; row: number } {
    for (let r = 0; ; r++) {
      for (let c = 0; c <= gridCols - spanCols; c++) {
        let fits = true;
        for (let dr = 0; dr < spanRows && fits; dr++) {
          for (let dc = 0; dc < spanCols && fits; dc++) {
            if (isOccupied(r + dr, c + dc)) fits = false;
          }
        }
        if (fits) return { col: c, row: r };
      }
    }
  }

  const result: PackedTerminal[] = [];

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const sCols = Math.min(span.cols, gridCols);
    const sRows = span.rows;

    const { col, row } = findPosition(sCols, sRows);
    markOccupied(row, col, sCols, sRows);

    result.push({
      index: i,
      col,
      row,
      span: { cols: sCols, rows: sRows },
      x: col * (tileW + GRID_GAP),
      y: row * (tileH + GRID_GAP),
      w: sCols * tileW + (sCols - 1) * GRID_GAP,
      h: sRows * tileH + (sRows - 1) * GRID_GAP,
    });
  }

  return result;
}

export function computeWorktreeSize(
  spans: TerminalSpan[],
  gridCols?: number,
  tileDims: TileDims = getDefaultTileDims(),
): {
  w: number;
  h: number;
} {
  if (spans.length === 0)
    return { w: WT_MIN_W, h: WT_TITLE_H + WT_PAD + WT_EMPTY_BODY_H + WT_PAD };

  const packed = packTerminals(spans, gridCols, tileDims);
  let maxCol = 0;
  let maxRow = 0;
  for (const p of packed) {
    maxCol = Math.max(maxCol, p.col + p.span.cols);
    maxRow = Math.max(maxRow, p.row + p.span.rows);
  }

  const tileW = tileDims.w;
  const tileH = tileDims.h;
  const w = maxCol * tileW + (maxCol - 1) * GRID_GAP + WT_PAD * 2;
  const h =
    WT_TITLE_H +
    WT_PAD +
    maxRow * tileH +
    (maxRow - 1) * GRID_GAP +
    WT_PAD;
  return { w, h };
}

export function getWorktreeSize(
  spans: TerminalSpan[],
  collapsed: boolean,
  gridCols?: number,
  tileDims: TileDims = getDefaultTileDims(),
): {
  w: number;
  h: number;
} {
  if (collapsed) {
    return { w: WT_MIN_W, h: WT_TITLE_H };
  }
  return computeWorktreeSize(spans, gridCols, tileDims);
}

export function getStandardWorktreeWidth(
  gridCols: number = DEFAULT_GRID_COLS,
  tileDims: TileDims = getDefaultTileDims(),
): number {
  return gridCols * tileDims.w + Math.max(0, gridCols - 1) * GRID_GAP + WT_PAD * 2;
}
