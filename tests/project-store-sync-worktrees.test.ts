import test from "node:test";
import assert from "node:assert/strict";

import { useProjectStore } from "../src/stores/projectStore.ts";
import { useTerminalRuntimeStateStore } from "../src/stores/terminalRuntimeStateStore.ts";
import { useWorkspaceStore } from "../src/stores/workspaceStore.ts";
import type { ProjectData } from "../src/types/index.ts";

function createTerminalFixture(id: string, title: string) {
  return {
    id,
    title,
    type: "shell" as const,
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle" as const,
    x: 0,
    y: 0,
    width: 640,
    height: 480,
    tags: [],
  };
}

function createProject(): ProjectData {
  return {
    id: "project-1",
    name: "Project One",
    path: "/tmp/project-1",
    worktrees: [
      {
        id: "worktree-main",
        name: "main",
        path: "/tmp/project-1",
        terminals: [createTerminalFixture("terminal-1", "Terminal 1")],
      },
    ],
  };
}

function resetStore(projects: ProjectData[]) {
  useTerminalRuntimeStateStore.getState().reset();
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

test("syncWorktrees no-op keeps references and does not notify subscribers", () => {
  const project = createProject();
  resetStore([project]);

  const beforeProjects = useProjectStore.getState().projects;
  const beforeProject = beforeProjects[0];
  const beforeWorktree = beforeProject.worktrees[0];

  let notifications = 0;
  const unsubscribe = useProjectStore.subscribe(() => {
    notifications += 1;
  });

  useProjectStore
    .getState()
    .syncWorktrees("/tmp/project-1", [
      { path: "/tmp/project-1", branch: "main", isMain: true },
    ]);
  unsubscribe();

  const afterProjects = useProjectStore.getState().projects;
  assert.equal(notifications, 0);
  assert.strictEqual(afterProjects, beforeProjects);
  assert.strictEqual(afterProjects[0], beforeProject);
  assert.strictEqual(afterProjects[0].worktrees[0], beforeWorktree);
  assert.equal(useWorkspaceStore.getState().dirty, false);
});

test("syncWorktrees still updates renamed branches", () => {
  resetStore([createProject()]);

  useProjectStore
    .getState()
    .syncWorktrees("/tmp/project-1", [
      { path: "/tmp/project-1", branch: "feature/new-name", isMain: true },
    ]);

  const state = useProjectStore.getState();
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].worktrees.length, 1);
  assert.equal(state.projects[0].worktrees[0].name, "feature/new-name");
  assert.equal(state.projects[0].worktrees[0].path, "/tmp/project-1");
});

test("syncWorktrees still adds and removes worktrees", () => {
  resetStore([createProject()]);

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
    { path: "/tmp/project-1", branch: "main", isMain: true },
    { path: "/tmp/project-1-feature", branch: "feature", isMain: false },
  ]);

  let state = useProjectStore.getState();
  assert.equal(state.projects[0].worktrees.length, 2);
  const feature = state.projects[0].worktrees.find(
    (worktree) => worktree.path === "/tmp/project-1-feature",
  );
  assert.ok(feature);
  assert.deepEqual(feature!.terminals, []);

  useProjectStore
    .getState()
    .syncWorktrees("/tmp/project-1", [
      { path: "/tmp/project-1-feature", branch: "feature", isMain: true },
    ]);

  state = useProjectStore.getState();
  assert.equal(state.projects[0].worktrees.length, 1);
  assert.equal(state.projects[0].worktrees[0].path, "/tmp/project-1-feature");
  assert.equal(state.projects[0].worktrees[0].name, "feature");
});

test("syncWorktrees clears removed runtime state and normalizes focused worktree ids", () => {
  const project = createProject();
  project.worktrees.push({
    id: "worktree-feature",
    name: "feature",
    path: "/tmp/project-1-feature",
    terminals: [createTerminalFixture("terminal-feature", "Feature Terminal")],
  });

  resetStore([project]);
  useProjectStore.setState({
    focusedProjectId: project.id,
    focusedWorktreeId: "worktree-feature",
  });
  useTerminalRuntimeStateStore
    .getState()
    .setSessionId("terminal-feature", "session-feature");

  useProjectStore
    .getState()
    .syncWorktrees("/tmp/project-1", [
      { path: "/tmp/project-1", branch: "main", isMain: true },
    ]);

  const state = useProjectStore.getState();
  assert.equal(state.focusedProjectId, "project-1");
  assert.equal(state.focusedWorktreeId, null);
  assert.equal(state.projects[0].worktrees.length, 1);
  assert.deepEqual(useTerminalRuntimeStateStore.getState().terminals, {});
});

test("addTerminal adds a terminal with auto-tags", () => {
  const project = createProject();
  resetStore([project]);

  useProjectStore.getState().addTerminal(project.id, project.worktrees[0].id, {
    id: "terminal-new",
    title: "Terminal New",
    type: "claude",
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    x: 0,
    y: 0,
    width: 640,
    height: 480,
    tags: [],
  });

  const terminal =
    useProjectStore.getState().projects[0].worktrees[0].terminals[1];
  assert.ok(terminal);
  assert.equal(terminal.id, "terminal-new");
  assert.ok(terminal.tags.includes("project:Project One"));
  assert.ok(terminal.tags.includes("worktree:main"));
  assert.ok(terminal.tags.includes("type:claude"));
});

test("removeTerminal keeps an empty focused worktree after deleting its last terminal", () => {
  const project = createProject();
  project.worktrees[0].terminals[0].focused = true;

  useProjectStore.setState({
    projects: [project],
    focusedProjectId: project.id,
    focusedWorktreeId: project.worktrees[0].id,
  });

  useProjectStore
    .getState()
    .removeTerminal(project.id, project.worktrees[0].id, "terminal-1");

  const state = useProjectStore.getState();
  const worktree = state.projects[0].worktrees[0];

  assert.equal(worktree.terminals.length, 0);
  assert.equal(state.focusedProjectId, project.id);
  assert.equal(state.focusedWorktreeId, project.worktrees[0].id);
});
