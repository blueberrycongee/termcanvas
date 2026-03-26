import test from "node:test";
import assert from "node:assert/strict";

import * as gitContentLayout from "../src/components/LeftPanel/gitContentLayout.ts";

test("summarizeBranchInventory prioritizes the current local branch and counts branch groups", () => {
  const summarizeBranchInventory = (
    gitContentLayout as Record<string, unknown>
  ).summarizeBranchInventory as
    | ((branches: unknown[]) => {
        localBranchCount: number;
        remoteBranchCount: number;
        currentBranchName: string | null;
        trackingName: string | null;
        orderedLocalBranchNames: string[];
      })
    | undefined;

  assert.equal(typeof summarizeBranchInventory, "function");

  const summary = summarizeBranchInventory!([
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

test("summarizeGitHistoryMetrics reports commits, merges, contributors, and referenced commits", () => {
  const summarizeGitHistoryMetrics = (
    gitContentLayout as Record<string, unknown>
  ).summarizeGitHistoryMetrics as
    | ((commits: unknown[]) => {
        commitCount: number;
        mergeCount: number;
        contributorCount: number;
        referencedCommitCount: number;
      })
    | undefined;

  assert.equal(typeof summarizeGitHistoryMetrics, "function");

  const summary = summarizeGitHistoryMetrics!([
    {
      hash: "m",
      parents: ["b", "c"],
      refs: ["HEAD -> main", "origin/main"],
      author: "Alice",
      date: "2026-03-26T00:00:00.000Z",
      message: "merge feature",
      lane: 0,
      row: 0,
    },
    {
      hash: "b",
      parents: ["a"],
      refs: [],
      author: "Alice",
      date: "2026-03-25T00:00:00.000Z",
      message: "main work",
      lane: 0,
      row: 1,
    },
    {
      hash: "c",
      parents: ["a"],
      refs: ["feature"],
      author: "Bob",
      date: "2026-03-24T00:00:00.000Z",
      message: "feature work",
      lane: 1,
      row: 2,
    },
  ]);

  assert.deepEqual(summary, {
    commitCount: 3,
    mergeCount: 1,
    contributorCount: 2,
    referencedCommitCount: 2,
  });
});

test("summarizeCommitFileStats totals file categories and line counts", () => {
  const summarizeCommitFileStats = (
    gitContentLayout as Record<string, unknown>
  ).summarizeCommitFileStats as
    | ((files: unknown[]) => {
        totalFiles: number;
        additions: number;
        deletions: number;
        binaryCount: number;
        imageCount: number;
        renamedCount: number;
      })
    | undefined;

  assert.equal(typeof summarizeCommitFileStats, "function");

  const summary = summarizeCommitFileStats!([
    {
      name: "src/components/GitContent.tsx",
      additions: 42,
      deletions: 10,
      binary: false,
      isImage: false,
      imageOld: null,
      imageNew: null,
    },
    {
      name: "assets/{old-logo.png => new-logo.png}",
      additions: 0,
      deletions: 0,
      binary: true,
      isImage: true,
      imageOld: "before",
      imageNew: "after",
    },
  ]);

  assert.deepEqual(summary, {
    totalFiles: 2,
    additions: 42,
    deletions: 10,
    binaryCount: 1,
    imageCount: 1,
    renamedCount: 1,
  });
});
