export interface CommitRefSummary {
  visibleRefs: string[];
  hiddenCount: number;
}

export interface VirtualCommitWindowInput {
  itemCount: number;
  overscan?: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
}

function refPriority(ref: string): number {
  if (ref.startsWith("HEAD")) return 0;
  if (ref.startsWith("tag:")) return 1;
  if (ref.startsWith("origin/")) return 2;
  return 3;
}

export function summarizeCommitRefs(
  refs: string[],
  maxVisible = 2,
): CommitRefSummary {
  const sortedRefs = [...refs].sort((left, right) => {
    const priorityDelta = refPriority(left) - refPriority(right);
    if (priorityDelta !== 0) return priorityDelta;
    return left.localeCompare(right);
  });

  return {
    visibleRefs: sortedRefs.slice(0, maxVisible),
    hiddenCount: Math.max(0, sortedRefs.length - maxVisible),
  };
}

export function buildAheadBehindLabel(
  ahead: number,
  behind: number,
): string | null {
  if (ahead <= 0 && behind <= 0) {
    return null;
  }

  if (ahead > 0 && behind > 0) {
    return `↑${ahead} ↓${behind}`;
  }

  if (ahead > 0) {
    return `↑${ahead}`;
  }

  return `↓${behind}`;
}

export function getVirtualCommitWindow({
  itemCount,
  overscan = 8,
  rowHeight,
  scrollTop,
  viewportHeight,
}: VirtualCommitWindowInput): { startIndex: number; endIndex: number } {
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    itemCount,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );

  return {
    startIndex,
    endIndex,
  };
}
