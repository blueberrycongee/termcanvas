export const TERMINAL_W = 540;
export const TERMINAL_H = 260;
export const GRID_GAP = 8;

export const WT_PAD = 10;
export const WT_TITLE_H = 36;

export const PROJ_PAD = 12;
export const PROJ_TITLE_H = 40;

export function computeGridCols(terminalCount: number): number {
  if (terminalCount <= 0) return 1;
  const aspect = window.innerWidth / window.innerHeight;
  return Math.max(1, Math.round(Math.sqrt(terminalCount * aspect)));
}

export function computeWorktreeSize(terminalCount: number): {
  w: number;
  h: number;
} {
  if (terminalCount === 0)
    return { w: 300, h: WT_TITLE_H + WT_PAD + 60 + WT_PAD };
  const cols = computeGridCols(terminalCount);
  const rows = Math.ceil(terminalCount / cols);
  const w = cols * TERMINAL_W + (cols - 1) * GRID_GAP + WT_PAD * 2;
  const h =
    WT_TITLE_H + WT_PAD + rows * TERMINAL_H + (rows - 1) * GRID_GAP + WT_PAD;
  return { w, h };
}

export function computeTerminalPosition(
  index: number,
  cols: number,
): { x: number; y: number } {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: col * (TERMINAL_W + GRID_GAP),
    y: row * (TERMINAL_H + GRID_GAP),
  };
}
