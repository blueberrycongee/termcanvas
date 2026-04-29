import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGitGraphRailModel,
  summarizeBranchInventory,
  summarizeCommitRefs,
  buildAheadBehindLabel,
  getCommitNodeCenterY,
  getCommitRowTop,
  getExpandedVirtualCommitWindow,
  getGitGraphRailMetrics,
  getStatusDisplayPath,
  getStatusColor,
  getStatusLabel,
  getVirtualCommitWindow,
} from "../src/components/RightPanel/gitContentLayout.ts";
import { buildGitGraph } from "../src/utils/gitGraph.ts";

test("summarizeBranchInventory prioritizes the current local branch and counts branch groups", () => {
  const summary = summarizeBranchInventory([
    {
      name: "feature/refactor",
      hash: "bbb2222",
      isCurrent: false,
      isRemote: false,
      upstream: "origin/feature/refactor",
      ahead: 0,
      behind: 0,
    },
    {
      name: "origin/feature/refactor",
      hash: "ccc3333",
      isCurrent: false,
      isRemote: true,
      upstream: null,
      ahead: 0,
      behind: 0,
    },
    {
      name: "main",
      hash: "aaa1111",
      isCurrent: true,
      isRemote: false,
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
    },
    {
      name: "origin/main",
      hash: "ddd4444",
      isCurrent: false,
      isRemote: true,
      upstream: null,
      ahead: 0,
      behind: 0,
    },
  ]);

  assert.deepEqual(summary, {
    localBranchCount: 2,
    remoteBranchCount: 2,
    currentBranchName: "main",
    trackingName: "origin/main",
    orderedLocalBranchNames: ["main", "feature/refactor"],
  });
});

test("summarizeCommitRefs sorts by priority and limits visible refs", () => {
  const result = summarizeCommitRefs(
    ["origin/main", "HEAD -> main", "tag: v1.0", "feature", "main"],
    {
      maxVisible: 3,
      currentBranchName: "main",
      localBranchNames: ["main", "feature"],
    },
  );

  assert.deepEqual(result.visibleRefs, ["HEAD -> main", "main", "feature"]);
  assert.equal(result.hiddenCount, 2);
});

test("summarizeCommitRefs returns empty for no refs", () => {
  const result = summarizeCommitRefs([]);
  assert.deepEqual(result.visibleRefs, []);
  assert.equal(result.hiddenCount, 0);
});

test("buildAheadBehindLabel formats ahead/behind correctly", () => {
  assert.equal(buildAheadBehindLabel(3, 0), "↑3");
  assert.equal(buildAheadBehindLabel(0, 2), "↓2");
  assert.equal(buildAheadBehindLabel(1, 5), "↑1 ↓5");
  assert.equal(buildAheadBehindLabel(0, 0), null);
});

test("getStatusDisplayPath splits filename and directory", () => {
  assert.deepEqual(getStatusDisplayPath("src/components/App.tsx"), {
    fileName: "App.tsx",
    directory: "src/components",
  });
  assert.deepEqual(getStatusDisplayPath("README.md"), {
    fileName: "README.md",
    directory: "",
  });
  assert.deepEqual(getStatusDisplayPath("a/b/c/d.ts"), {
    fileName: "d.ts",
    directory: "a/b/c",
  });
});

test("getStatusColor returns correct CSS variable for each status", () => {
  assert.equal(getStatusColor("M"), "var(--amber)");
  assert.equal(getStatusColor("A"), "var(--cyan)");
  assert.equal(getStatusColor("D"), "var(--red)");
  assert.equal(getStatusColor("R"), "var(--accent)");
  assert.equal(getStatusColor("?"), "var(--cyan)");
});

test("getStatusLabel maps untracked to U", () => {
  assert.equal(getStatusLabel("?"), "U");
  assert.equal(getStatusLabel("M"), "M");
  assert.equal(getStatusLabel("A"), "A");
});

test("getVirtualCommitWindow calculates visible range with overscan", () => {
  const result = getVirtualCommitWindow({
    itemCount: 100,
    rowHeight: 40,
    scrollTop: 200,
    viewportHeight: 400,
    overscan: 5,
  });

  assert.equal(result.startIndex, 0);
  assert.equal(result.endIndex, 20);
});

test("getGitGraphRailMetrics keeps compact widths and reports hidden lanes", () => {
  assert.deepEqual(getGitGraphRailMetrics(2), {
    railWidth: 23,
    visibleLaneCount: 2,
    hiddenLaneCount: 0,
    laneGap: 7,
    laneStartX: 8,
    overflowX: null,
  });

  assert.deepEqual(getGitGraphRailMetrics(8), {
    railWidth: 37,
    visibleLaneCount: 4,
    hiddenLaneCount: 4,
    laneGap: 7,
    laneStartX: 8,
    overflowX: 31,
  });
});

test("commit row helpers keep rows and nodes aligned around the expanded detail panel", () => {
  assert.equal(
    getCommitRowTop({ row: 1, rowHeight: 40, selectedIndex: 2, detailHeight: 90 }),
    40,
  );
  assert.equal(
    getCommitRowTop({ row: 3, rowHeight: 40, selectedIndex: 2, detailHeight: 90 }),
    210,
  );
  assert.equal(
    getCommitNodeCenterY({ row: 3, rowHeight: 40, selectedIndex: 2, detailHeight: 90 }),
    230,
  );
});

test("getExpandedVirtualCommitWindow covers rows on both sides of the inserted detail panel", () => {
  const result = getExpandedVirtualCommitWindow({
    itemCount: 100,
    rowHeight: 40,
    scrollTop: 400,
    viewportHeight: 160,
    detailHeight: 120,
    selectedIndex: 10,
    overscan: 1,
  });

  assert.deepEqual(result, {
    startIndex: 6,
    endIndex: 15,
  });
});

test("buildGitGraphRailModel returns visible nodes, highlighted parent edges, and curved merge paths", () => {
  const { commits, edges } = buildGitGraph([
    {
      hash: "m",
      parents: ["b", "c"],
      refs: ["HEAD -> main"],
      author: "Test User",
      date: "2026-03-26T00:00:00.000Z",
      message: "merge feature",
    },
    {
      hash: "b",
      parents: ["a"],
      refs: ["main"],
      author: "Test User",
      date: "2026-03-25T00:00:00.000Z",
      message: "main work",
    },
    {
      hash: "c",
      parents: ["a"],
      refs: ["feature"],
      author: "Test User",
      date: "2026-03-24T00:00:00.000Z",
      message: "feature work",
    },
    {
      hash: "a",
      parents: [],
      refs: [],
      author: "Test User",
      date: "2026-03-23T00:00:00.000Z",
      message: "root",
    },
  ]);

  const model = buildGitGraphRailModel({
    commits,
    edges,
    rowHeight: 40,
    visibleStartIndex: 0,
    visibleEndIndex: commits.length,
    selectedCommitHash: "m",
    hoveredCommitHash: null,
    selectedIndex: 0,
    detailHeight: 0,
  });

  const mergeNode = model.nodes.find((node) => node.hash === "m");
  const featureEdge = model.edges.find(
    (edge) => edge.fromHash === "m" && edge.toHash === "c",
  );
  const trunkEdge = model.edges.find(
    (edge) => edge.fromHash === "m" && edge.toHash === "b",
  );

  assert.ok(mergeNode);
  assert.equal(mergeNode.x, 8);
  assert.equal(mergeNode.y, 20);
  assert.equal(mergeNode.isMerge, true);
  assert.equal(mergeNode.isSelected, true);
  assert.equal(mergeNode.radius, 5);

  assert.ok(featureEdge);
  assert.ok(featureEdge.path.includes("C"));
  assert.equal(featureEdge.isFocused, true);

  assert.ok(trunkEdge);
  assert.ok(trunkEdge.path.includes("L"));
  assert.equal(trunkEdge.isFocused, true);
});

test("buildGitGraphRailModel collapses hidden lanes into an overflow rail marker", () => {
  const model = buildGitGraphRailModel({
    commits: Array.from({ length: 8 }, (_, lane) => ({
      hash: `c${lane}`,
      parents: [],
      refs: [],
      author: "Test User",
      date: "2026-03-20T00:00:00.000Z",
      message: `commit ${lane}`,
      lane,
      row: lane,
    })),
    edges: [],
    rowHeight: 40,
    visibleStartIndex: 0,
    visibleEndIndex: 8,
    selectedCommitHash: null,
    hoveredCommitHash: null,
    selectedIndex: -1,
    detailHeight: 0,
  });

  const overflowNode = model.nodes.find((node) => node.hash === "c7");

  assert.deepEqual(model.overflow, {
    x: 31,
    label: "+4 lanes",
    hiddenLaneCount: 4,
  });
  assert.ok(overflowNode);
  assert.equal(overflowNode.isOverflow, true);
  assert.equal(overflowNode.x, 31);
});
