import type { GitBranchInfo, GitFileStatus } from "../../types";
import { GRAPH_COLORS, type GraphCommit, type GraphEdge } from "../../utils/gitGraph";

export interface CommitRefSummary {
  visibleRefs: string[];
  hiddenCount: number;
}

export interface CommitRefSummaryOptions {
  currentBranchName?: string | null;
  localBranchNames?: string[];
  maxVisible?: number;
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

export interface GitGraphRailMetrics {
  railWidth: number;
  visibleLaneCount: number;
  hiddenLaneCount: number;
  laneGap: number;
  laneStartX: number;
  overflowX: number | null;
}

export interface GitGraphRailNode {
  color: string;
  hash: string;
  isFocused: boolean;
  isHoverTarget: boolean;
  isHovered: boolean;
  isMerge: boolean;
  isOverflow: boolean;
  isSelected: boolean;
  lane: number;
  radius: number;
  row: number;
  x: number;
  y: number;
}

export interface GitGraphRailEdgePath {
  color: string;
  fromHash: string;
  isFocused: boolean;
  path: string;
  toHash: string;
}

export interface GitGraphRailOverflow {
  hiddenLaneCount: number;
  label: string;
  x: number;
}

export interface BuildGitGraphRailModelInput {
  commits: GraphCommit[];
  detailHeight: number;
  edges: GraphEdge[];
  hoveredCommitHash: string | null;
  rowHeight: number;
  selectedCommitHash: string | null;
  selectedIndex: number;
  visibleEndIndex: number;
  visibleStartIndex: number;
}

export interface GitGraphRailModel {
  edges: GitGraphRailEdgePath[];
  metrics: GitGraphRailMetrics;
  nodes: GitGraphRailNode[];
  overflow: GitGraphRailOverflow | null;
  railWidth: number;
}

export interface CommitRowPositionInput {
  detailHeight: number;
  row: number;
  rowHeight: number;
  selectedIndex: number;
}

export interface ExpandedVirtualCommitWindowInput extends VirtualCommitWindowInput {
  detailHeight: number;
  selectedIndex: number;
}

const GRAPH_RAIL_MIN_WIDTH = 20;
const GRAPH_RAIL_VISIBLE_LANES = 4;
const GRAPH_RAIL_LANE_GAP = 7;
const GRAPH_RAIL_LANE_START_X = 8;
const GRAPH_RAIL_OVERFLOW_INSET = 6;

function refPriority(
  ref: string,
  { currentBranchName, localBranchNames }: CommitRefSummaryOptions,
): number {
  if (ref.startsWith("HEAD")) return 0;
  if (currentBranchName && ref === currentBranchName) return 1;
  if (localBranchNames?.includes(ref)) return 2;
  if (ref.startsWith("tag:")) return 3;
  if (ref.startsWith("origin/")) return 4;
  return 5;
}

export function summarizeCommitRefs(
  refs: string[],
  optionsOrMaxVisible: number | CommitRefSummaryOptions = 2,
): CommitRefSummary {
  const options = typeof optionsOrMaxVisible === "number"
    ? { maxVisible: optionsOrMaxVisible }
    : optionsOrMaxVisible;
  const maxVisible = options.maxVisible ?? 2;
  const sortedRefs = [...refs].sort((left, right) => {
    const priorityDelta = refPriority(left, options) - refPriority(right, options);
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

export function getExpandedVirtualCommitWindow({
  detailHeight,
  itemCount,
  overscan,
  rowHeight,
  scrollTop,
  selectedIndex,
  viewportHeight,
}: ExpandedVirtualCommitWindowInput): { startIndex: number; endIndex: number } {
  const baseWindow = getVirtualCommitWindow({
    itemCount,
    overscan,
    rowHeight,
    scrollTop,
    viewportHeight,
  });

  if (selectedIndex < 0 || detailHeight <= 0) {
    return baseWindow;
  }

  const expandedWindow = getVirtualCommitWindow({
    itemCount,
    overscan,
    rowHeight,
    scrollTop: Math.max(0, scrollTop - detailHeight),
    viewportHeight: viewportHeight + detailHeight,
  });

  return {
    startIndex: Math.min(baseWindow.startIndex, expandedWindow.startIndex),
    endIndex: Math.max(baseWindow.endIndex, expandedWindow.endIndex),
  };
}

export function getGitGraphRailMetrics(totalLaneCount: number): GitGraphRailMetrics {
  if (totalLaneCount <= 0) {
    return {
      railWidth: GRAPH_RAIL_MIN_WIDTH,
      visibleLaneCount: 0,
      hiddenLaneCount: 0,
      laneGap: GRAPH_RAIL_LANE_GAP,
      laneStartX: GRAPH_RAIL_LANE_START_X,
      overflowX: null,
    };
  }

  const visibleLaneCount = Math.min(totalLaneCount, GRAPH_RAIL_VISIBLE_LANES);
  const hiddenLaneCount = Math.max(0, totalLaneCount - visibleLaneCount);
  const computedWidth = GRAPH_RAIL_LANE_START_X * 2
    + Math.max(0, visibleLaneCount - 1) * GRAPH_RAIL_LANE_GAP;
  const railWidth = Math.max(GRAPH_RAIL_MIN_WIDTH, computedWidth);

  return {
    railWidth,
    visibleLaneCount,
    hiddenLaneCount,
    laneGap: GRAPH_RAIL_LANE_GAP,
    laneStartX: GRAPH_RAIL_LANE_START_X,
    overflowX: hiddenLaneCount > 0 ? railWidth - GRAPH_RAIL_OVERFLOW_INSET : null,
  };
}

export function getCommitRowTop({
  detailHeight,
  row,
  rowHeight,
  selectedIndex,
}: CommitRowPositionInput): number {
  const extraOffset = selectedIndex >= 0 && row > selectedIndex ? detailHeight : 0;
  return row * rowHeight + extraOffset;
}

export function getCommitNodeCenterY(input: CommitRowPositionInput): number {
  return getCommitRowTop(input) + input.rowHeight / 2;
}

function getLaneX(lane: number, metrics: GitGraphRailMetrics): number {
  if (metrics.hiddenLaneCount > 0 && lane >= metrics.visibleLaneCount) {
    return metrics.overflowX ?? metrics.laneStartX;
  }

  return metrics.laneStartX + lane * metrics.laneGap;
}

function buildEdgePath(fromX: number, fromY: number, toX: number, toY: number): string {
  if (fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }

  const midY = fromY + (toY - fromY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}

export function buildGitGraphRailModel({
  commits,
  detailHeight,
  edges,
  hoveredCommitHash,
  rowHeight,
  selectedCommitHash,
  selectedIndex,
  visibleEndIndex,
  visibleStartIndex,
}: BuildGitGraphRailModelInput): GitGraphRailModel {
  const laneCount = commits.reduce((maxLane, commit) => Math.max(maxLane, commit.lane), -1) + 1;
  const metrics = getGitGraphRailMetrics(laneCount);
  const visibleCommits = commits.slice(visibleStartIndex, visibleEndIndex);
  const interactiveCommitHash = hoveredCommitHash ?? selectedCommitHash;
  const focusCommit = interactiveCommitHash
    ? commits.find((commit) => commit.hash === interactiveCommitHash) ?? null
    : null;
  const focusedNodeHashes = new Set<string>();

  if (focusCommit) {
    focusedNodeHashes.add(focusCommit.hash);
    for (const parent of focusCommit.parents) {
      focusedNodeHashes.add(parent);
    }
  }

  const nodes = visibleCommits.map((commit) => {
    const isSelected = commit.hash === selectedCommitHash;
    const isHovered = commit.hash === hoveredCommitHash;
    return {
      color: GRAPH_COLORS[commit.lane % GRAPH_COLORS.length],
      hash: commit.hash,
      isFocused: focusedNodeHashes.has(commit.hash),
      isHoverTarget: commit.hash === interactiveCommitHash,
      isHovered,
      isMerge: commit.parents.length > 1,
      isOverflow: metrics.hiddenLaneCount > 0 && commit.lane >= metrics.visibleLaneCount,
      isSelected,
      lane: commit.lane,
      radius: isSelected ? 5 : 3.5,
      row: commit.row,
      x: getLaneX(commit.lane, metrics),
      y: getCommitNodeCenterY({
        detailHeight,
        row: commit.row,
        rowHeight,
        selectedIndex,
      }),
    } satisfies GitGraphRailNode;
  });

  const railEdges = edges
    .filter((edge) => edge.toRow >= visibleStartIndex && edge.fromRow < visibleEndIndex)
    .map((edge) => ({
      color: edge.color,
      fromHash: edge.fromHash,
      isFocused: interactiveCommitHash === edge.fromHash,
      path: buildEdgePath(
        getLaneX(edge.fromLane, metrics),
        getCommitNodeCenterY({
          detailHeight,
          row: edge.fromRow,
          rowHeight,
          selectedIndex,
        }),
        getLaneX(edge.toLane, metrics),
        getCommitNodeCenterY({
          detailHeight,
          row: edge.toRow,
          rowHeight,
          selectedIndex,
        }),
      ),
      toHash: edge.toHash,
    }));

  return {
    edges: railEdges,
    metrics,
    nodes,
    overflow: metrics.hiddenLaneCount > 0 && metrics.overflowX !== null
      ? {
          hiddenLaneCount: metrics.hiddenLaneCount,
          label: metrics.hiddenLaneCount === 1
            ? "+1 lane"
            : `+${metrics.hiddenLaneCount} lanes`,
          x: metrics.overflowX,
        }
      : null,
    railWidth: metrics.railWidth,
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
