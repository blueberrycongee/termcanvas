export interface PtyResizeSnapshot {
  ptyId: number;
  cols: number;
  rows: number;
}

export function getPtyResizeDecision(
  previous: PtyResizeSnapshot | null,
  next: PtyResizeSnapshot,
): { shouldResize: boolean } {
  if (!previous) {
    return { shouldResize: true };
  }

  return {
    shouldResize:
      previous.ptyId !== next.ptyId ||
      previous.cols !== next.cols ||
      previous.rows !== next.rows,
  };
}
