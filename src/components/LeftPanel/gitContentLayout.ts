import type { GitBranchInfo, GitFileStatus } from "../../types";

export interface CommitRefSummary {
  visibleRefs: string[];
  hiddenCount: number;
}

export interface BranchInventorySummary {
  localBranchCount: number;
  remoteBranchCount: number;
  currentBranchName: string | null;
  trackingName: string | null;
  orderedLocalBranchNames: string[];
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

export function summarizeBranchInventory(
  branches: GitBranchInfo[],
): BranchInventorySummary {
  const localBranches = branches.filter((branch) => !branch.isRemote);
  const remoteBranchCount = branches.length - localBranches.length;
  const sortedLocalBranches = [...localBranches].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) {
      return left.isCurrent ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  const currentBranch = sortedLocalBranches.find((branch) => branch.isCurrent) ?? null;

  return {
    localBranchCount: localBranches.length,
    remoteBranchCount,
    currentBranchName: currentBranch?.name ?? null,
    trackingName: currentBranch?.upstream ?? null,
    orderedLocalBranchNames: sortedLocalBranches.map((branch) => branch.name),
  };
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

// -- Source control utilities --

export function getStatusDisplayPath(filePath: string): { fileName: string; directory: string } {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) {
    return { fileName: filePath, directory: "" };
  }
  return {
    fileName: filePath.slice(lastSlash + 1),
    directory: filePath.slice(0, lastSlash),
  };
}

const STATUS_COLORS: Record<GitFileStatus, string> = {
  M: "var(--amber)",
  A: "var(--cyan)",
  D: "var(--red)",
  R: "var(--accent)",
  C: "var(--accent)",
  U: "var(--red)",
  "?": "var(--cyan)",
};

export function getStatusColor(status: GitFileStatus): string {
  return STATUS_COLORS[status] ?? "var(--text-secondary)";
}

const STATUS_LABELS: Record<GitFileStatus, string> = {
  M: "M",
  A: "A",
  D: "D",
  R: "R",
  C: "C",
  U: "U",
  "?": "U",
};

export function getStatusLabel(status: GitFileStatus): string {
  return STATUS_LABELS[status] ?? status;
}
