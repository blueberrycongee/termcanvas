import test from "node:test";
import assert from "node:assert/strict";

import { useProjectStore } from "../src/stores/projectStore.ts";
import type { ProjectData } from "../src/types/index.ts";

function createProject(): ProjectData {
  return {
    id: "project-1",
    name: "Project One",
    path: "/tmp/project-1",
    position: { x: 0, y: 0 },
    collapsed: false,
    zIndex: 1,
    worktrees: [
      {
        id: "worktree-main",
        name: "main",
        path: "/tmp/project-1",
        position: { x: 10, y: 20 },
        collapsed: false,
        terminals: [
          {
            id: "terminal-1",
            title: "Terminal 1",
            type: "shell",
            minimized: false,
            focused: false,
            ptyId: null,
            status: "idle",
            span: { cols: 1, rows: 1 },
          },
        ],
      },
    ],
  };
}

function resetStore(projects: ProjectData[]) {
  useProjectStore.setState({
    projects,
    focusedProjectId: null,
    focusedWorktreeId: null,
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

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
    { path: "/tmp/project-1", branch: "main", isMain: true },
  ]);
  unsubscribe();

  const afterProjects = useProjectStore.getState().projects;
  assert.equal(notifications, 0);
  assert.strictEqual(afterProjects, beforeProjects);
  assert.strictEqual(afterProjects[0], beforeProject);
  assert.strictEqual(afterProjects[0].worktrees[0], beforeWorktree);
});

test("syncWorktrees still updates renamed branches", () => {
  resetStore([createProject()]);

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
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
  assert.equal(feature!.collapsed, true);
  assert.deepEqual(feature!.position, { x: 0, y: 0 });
  assert.deepEqual(feature!.terminals, []);

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
    { path: "/tmp/project-1-feature", branch: "feature", isMain: true },
  ]);

  state = useProjectStore.getState();
  assert.equal(state.projects[0].worktrees.length, 1);
  assert.equal(state.projects[0].worktrees[0].path, "/tmp/project-1-feature");
  assert.equal(state.projects[0].worktrees[0].name, "feature");
});

test("syncWorktrees resolves cascaded overlaps when many worktrees are added at once", () => {
  const project = createProject();
  project.worktrees = [
    {
      ...project.worktrees[0],
      position: { x: 0, y: 20 },
    },
    {
      id: "worktree-side",
      name: "side",
      path: "/tmp/project-1-side",
      position: { x: 2200, y: 500 },
      collapsed: true,
      terminals: [],
    },
    {
      id: "worktree-tail",
      name: "tail",
      path: "/tmp/project-1-tail",
      position: { x: 0, y: 560 },
      collapsed: true,
      terminals: [],
    },
  ];

  resetStore([project]);

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
    { path: "/tmp/project-1", branch: "main", isMain: true },
    { path: "/tmp/project-1-feature-a", branch: "feature-a", isMain: false },
    { path: "/tmp/project-1-feature-b", branch: "feature-b", isMain: false },
    { path: "/tmp/project-1-side", branch: "side", isMain: false },
    { path: "/tmp/project-1-tail", branch: "tail", isMain: false },
  ]);

  const worktrees = useProjectStore.getState().projects[0].worktrees;
  const featureB = worktrees.find((worktree) => worktree.name === "feature-b");
  const tail = worktrees.find((worktree) => worktree.id === "worktree-tail");

  assert.ok(featureB);
  assert.ok(tail);
  assert.equal(featureB!.position.y, 124);
  assert.equal(tail!.position.y, 792);
});

test("addTerminal reflows every later worktree after the active worktree grows", () => {
  const project = createProject();
  project.worktrees = [
    {
      ...project.worktrees[0],
      position: { x: 0, y: 0 },
      terminals: [
        project.worktrees[0].terminals[0],
        {
          ...project.worktrees[0].terminals[0],
          id: "terminal-2",
          title: "Terminal 2",
        },
        {
          ...project.worktrees[0].terminals[0],
          id: "terminal-3",
          title: "Terminal 3",
        },
      ],
    },
    {
      id: "worktree-side",
      name: "side",
      path: "/tmp/project-1-side",
      position: { x: 2200, y: 600 },
      collapsed: true,
      terminals: [],
    },
    {
      id: "worktree-tail",
      name: "tail",
      path: "/tmp/project-1-tail",
      position: { x: 0, y: 700 },
      collapsed: true,
      terminals: [],
    },
  ];

  useProjectStore.setState({
    projects: [project],
    focusedProjectId: project.id,
    focusedWorktreeId: project.worktrees[0].id,
  });

  useProjectStore.getState().addTerminal(project.id, project.worktrees[0].id, {
    id: "terminal-4",
    title: "Terminal 4",
    type: "shell",
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    span: { cols: 1, rows: 1 },
  });

  const tail = useProjectStore
    .getState()
    .projects[0].worktrees.find((worktree) => worktree.id === "worktree-tail");

  assert.ok(tail);
  assert.equal(tail!.position.y, 1032);
});

test("removeTerminal keeps an empty focused worktree expanded after deleting its last terminal", () => {
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
  assert.equal(worktree.collapsed, false);
  assert.equal(state.focusedProjectId, project.id);
  assert.equal(state.focusedWorktreeId, project.worktrees[0].id);
});
