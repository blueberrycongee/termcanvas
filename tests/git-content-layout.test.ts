import test from "node:test";
import assert from "node:assert/strict";

import {
  summarizeBranchInventory,
  summarizeCommitRefs,
  buildAheadBehindLabel,
  getStatusDisplayPath,
  getStatusColor,
  getStatusLabel,
  getVirtualCommitWindow,
} from "../src/components/LeftPanel/gitContentLayout.ts";

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
    ["origin/main", "HEAD -> main", "tag: v1.0", "feature"],
    2,
  );

  assert.deepEqual(result.visibleRefs, ["HEAD -> main", "tag: v1.0"]);
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

  // scrollTop=200, rowHeight=40 → first visible = 5
  // startIndex = max(0, 5-5) = 0
  // endIndex = min(100, ceil((200+400)/40) + 5) = min(100, 15+5) = 20
  assert.equal(result.startIndex, 0);
  assert.equal(result.endIndex, 20);
});
