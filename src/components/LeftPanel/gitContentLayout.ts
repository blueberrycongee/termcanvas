export interface CommitRefSummary {
  visibleRefs: string[];
  hiddenCount: number;
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
