import type { GitBranchInfo, GitCommitFile } from "../../types";
import type { GraphCommit } from "../../utils/gitGraph";

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

export interface GitHistoryMetrics {
  commitCount: number;
  mergeCount: number;
  contributorCount: number;
  referencedCommitCount: number;
}

export interface CommitFileStats {
  totalFiles: number;
  additions: number;
  deletions: number;
  binaryCount: number;
  imageCount: number;
  renamedCount: number;
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

export function summarizeGitHistoryMetrics(
  commits: Array<Pick<GraphCommit, "author" | "parents" | "refs">>,
): GitHistoryMetrics {
  const contributors = new Set<string>();
  let mergeCount = 0;
  let referencedCommitCount = 0;

  for (const commit of commits) {
    contributors.add(commit.author);
    if (commit.parents.length > 1) {
      mergeCount += 1;
    }
    if (commit.refs.length > 0) {
      referencedCommitCount += 1;
    }
  }

  return {
    commitCount: commits.length,
    mergeCount,
    contributorCount: contributors.size,
    referencedCommitCount,
  };
}

export function summarizeCommitFileStats(
  files: GitCommitFile[],
): CommitFileStats {
  let additions = 0;
  let deletions = 0;
  let binaryCount = 0;
  let imageCount = 0;
  let renamedCount = 0;

  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
    if (file.binary) {
      binaryCount += 1;
    }
    if (file.isImage) {
      imageCount += 1;
    }
    if (file.name.includes("=>")) {
      renamedCount += 1;
    }
  }

  return {
    totalFiles: files.length,
    additions,
    deletions,
    binaryCount,
    imageCount,
    renamedCount,
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
