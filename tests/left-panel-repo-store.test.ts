import test from "node:test";
import assert from "node:assert/strict";

test("diff cache keeps the last diff visible while refreshing", async () => {
  const { useLeftPanelRepoStore } = await import(
    `../src/stores/leftPanelRepoStore.ts?diff-${Date.now()}`
  );

  const path = "/tmp/acme";
  const store = useLeftPanelRepoStore.getState();

  store.beginDiffLoad(path);
  assert.deepEqual(useLeftPanelRepoStore.getState().diffByPath[path], {
    fileDiffs: [],
    loaded: false,
    loading: true,
    refreshing: false,
  });

  store.resolveDiffLoad(path, [
    {
      file: {
        additions: 3,
        binary: false,
        deletions: 1,
        imageNew: null,
        imageOld: null,
        isImage: false,
        name: "src/app.ts",
      },
      hunks: ["@@ -1 +1 @@", "+hello"],
    },
  ]);

  store.beginDiffLoad(path);
  assert.deepEqual(useLeftPanelRepoStore.getState().diffByPath[path], {
    fileDiffs: [
      {
        file: {
          additions: 3,
          binary: false,
          deletions: 1,
          imageNew: null,
          imageOld: null,
          isImage: false,
          name: "src/app.ts",
        },
        hunks: ["@@ -1 +1 @@", "+hello"],
      },
    ],
    loaded: true,
    loading: false,
    refreshing: true,
  });
});

test("git log cache refreshes without clearing existing history", async () => {
  const { useLeftPanelRepoStore } = await import(
    `../src/stores/leftPanelRepoStore.ts?git-log-${Date.now()}`
  );

  const path = "/tmp/acme";
  const store = useLeftPanelRepoStore.getState();

  store.resolveGitLogLoad(path, {
    branches: [
      {
        ahead: 0,
        behind: 0,
        isCurrent: true,
        isRemote: false,
        name: "main",
      },
    ],
    count: 400,
    isGitRepo: true,
    logEntries: [
      {
        author: "Andy",
        date: "2026-04-06T00:00:00.000Z",
        hash: "abc1234",
        message: "Initial commit",
        parents: [],
        refs: ["HEAD -> main"],
      },
    ],
  });

  store.beginGitLogLoad(path, "refresh", 400);
  assert.deepEqual(useLeftPanelRepoStore.getState().gitLogByPath[path], {
    branches: [
      {
        ahead: 0,
        behind: 0,
        isCurrent: true,
        isRemote: false,
        name: "main",
      },
    ],
    count: 400,
    isGitRepo: true,
    loaded: true,
    loading: false,
    loadingMore: false,
    logEntries: [
      {
        author: "Andy",
        date: "2026-04-06T00:00:00.000Z",
        hash: "abc1234",
        message: "Initial commit",
        parents: [],
        refs: ["HEAD -> main"],
      },
    ],
    refreshing: true,
  });
});

test("git status cache keeps file lists during background refresh", async () => {
  const { useLeftPanelRepoStore } = await import(
    `../src/stores/leftPanelRepoStore.ts?git-status-${Date.now()}`
  );

  const path = "/tmp/acme";
  const store = useLeftPanelRepoStore.getState();

  store.resolveGitStatusLoad(path, {
    changedFiles: [
      { path: "src/app.ts", staged: false, status: "M" },
    ],
    stagedFiles: [
      { path: "src/store.ts", staged: true, status: "A" },
    ],
  });

  store.beginGitStatusLoad(path);
  assert.deepEqual(useLeftPanelRepoStore.getState().gitStatusByPath[path], {
    changedFiles: [
      { path: "src/app.ts", staged: false, status: "M" },
    ],
    loaded: true,
    loading: false,
    refreshing: true,
    stagedFiles: [
      { path: "src/store.ts", staged: true, status: "A" },
    ],
  });
});
