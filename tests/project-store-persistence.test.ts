import test from "node:test";
import assert from "node:assert/strict";

import { useProjectStore } from "../src/stores/projectStore.ts";
import { useWorkspaceStore } from "../src/stores/workspaceStore.ts";
import type { ProjectData } from "../src/types/index.ts";

function createProject(): ProjectData {
  return {
    id: "project-1",
    name: "Project One",
    path: "/tmp/project-1",
    worktrees: [
      {
        id: "worktree-1",
        name: "main",
        path: "/tmp/project-1",
        terminals: [
          {
            id: "terminal-1",
            title: "Terminal 1",
            type: "shell",
            minimized: false,
            focused: false,
            ptyId: null,
            status: "idle",
            x: 0,
            y: 0,
            width: 640,
            height: 480,
            tags: [],
          },
        ],
      },
    ],
  };
}

function resetStores(projects: ProjectData[]) {
  useProjectStore.setState({
    projects,
    focusedProjectId: null,
    focusedWorktreeId: null,
  });
  useWorkspaceStore.setState({
    workspacePath: null,
    dirty: false,
    lastSavedAt: null,
    lastDirtyAt: null,
  });
}

test("syncWorktrees marks the workspace dirty when the project set changes", () => {
  resetStores([createProject()]);

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
    { path: "/tmp/project-1", branch: "main", isMain: true },
    { path: "/tmp/project-1-feature", branch: "feature", isMain: false },
  ]);

  assert.equal(useWorkspaceStore.getState().dirty, true);
  assert.ok(useWorkspaceStore.getState().lastDirtyAt !== null);
});

test("updateTerminalAutoApprove marks the workspace dirty", () => {
  resetStores([createProject()]);

  useProjectStore
    .getState()
    .updateTerminalAutoApprove("project-1", "worktree-1", "terminal-1", true);

  assert.equal(useWorkspaceStore.getState().dirty, true);
  assert.equal(
    useProjectStore.getState().projects[0]?.worktrees[0]?.terminals[0]
      ?.autoApprove,
    true,
  );
});

test("updateTerminalType marks the workspace dirty", () => {
  resetStores([createProject()]);

  useProjectStore
    .getState()
    .updateTerminalType("project-1", "worktree-1", "terminal-1", "codex");

  assert.equal(useWorkspaceStore.getState().dirty, true);
  assert.equal(
    useProjectStore.getState().projects[0]?.worktrees[0]?.terminals[0]?.type,
    "codex",
  );
});
