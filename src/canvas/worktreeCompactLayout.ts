export const DEFAULT_WORKTREE_COMPACT_COLUMNS = 3;
export const MIN_WORKTREE_COMPACT_COLUMNS = 1;
export const MAX_WORKTREE_COMPACT_COLUMNS = 6;

const COMPACT_GAP = 12;

interface CompactTerminal {
  id: string;
  width: number;
  height: number;
}

export function sanitizeWorktreeCompactColumns(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_WORKTREE_COMPACT_COLUMNS;
  }

  return Math.max(
    MIN_WORKTREE_COMPACT_COLUMNS,
    Math.min(MAX_WORKTREE_COMPACT_COLUMNS, Math.round(value)),
  );
}

export function computeCompactOffsets(
  terminals: CompactTerminal[],
  preferredColumns: number = DEFAULT_WORKTREE_COMPACT_COLUMNS,
): Map<string, { x: number; y: number }> {
  const offsets = new Map<string, { x: number; y: number }>();
  if (terminals.length === 0) return offsets;

  const columns = Math.min(
    terminals.length,
    sanitizeWorktreeCompactColumns(preferredColumns),
  );
  let curX = 0;
  let curY = 0;
  let rowHeight = 0;

  terminals.forEach((terminal, index) => {
    if (index > 0 && index % columns === 0) {
      curX = 0;
      curY += rowHeight + COMPACT_GAP;
      rowHeight = 0;
    }

    offsets.set(terminal.id, { x: curX, y: curY });
    curX += terminal.width + COMPACT_GAP;
    rowHeight = Math.max(rowHeight, terminal.height);
  });

  return offsets;
}
