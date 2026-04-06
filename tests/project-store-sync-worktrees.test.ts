import test from "node:test";
import assert from "node:assert/strict";

import { getProjectBounds, useProjectStore } from "../src/stores/projectStore.ts";
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

function createEmptyWorktree(
  id: string,
  name: string,
  path: string,
  x: number,
  y: number,
) {
  return {
    id,
    name,
    path,
    position: { x, y },
    collapsed: true,
    terminals: [],
  };
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
  assert.equal(featureB!.position.y, 44);
  assert.equal(tail!.position.y, 632);
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

test("compactProjectWorktrees packs worktrees into tighter rows from visual order", () => {
  const project = createProject();
  const mainWorktree = project.worktrees[0];

  project.worktrees = [
    {
      ...mainWorktree,
      position: { x: 1000, y: 0 },
    },
    createEmptyWorktree(
      "worktree-small-1",
      "small-1",
      "/tmp/project-1-small-1",
      2500,
      10,
    ),
    createEmptyWorktree(
      "worktree-small-2",
      "small-2",
      "/tmp/project-1-small-2",
      2800,
      20,
    ),
    {
      id: "worktree-wide",
      name: "wide",
      path: "/tmp/project-1-wide",
      position: { x: 0, y: 1000 },
      collapsed: false,
      terminals: [
        {
          ...mainWorktree.terminals[0],
          id: "terminal-wide-1",
          title: "Wide 1",
        },
        {
          ...mainWorktree.terminals[0],
          id: "terminal-wide-2",
          title: "Wide 2",
        },
      ],
    },
  ];

  resetStore([project]);

  useProjectStore.getState().compactProjectWorktrees(project.id);

  const worktrees = useProjectStore.getState().projects[0].worktrees;
  assert.deepEqual(
    worktrees.map((worktree) => ({
      id: worktree.id,
      position: worktree.position,
    })),
    [
      { id: "worktree-main", position: { x: 0, y: 0 } },
      { id: "worktree-small-1", position: { x: 668, y: 0 } },
      { id: "worktree-small-2", position: { x: 976, y: 0 } },
      { id: "worktree-wide", position: { x: 0, y: 544 } },
    ],
  );
});

test("compactProjectWorktrees uses collapsed worktree footprint instead of hidden terminal size", () => {
  const project = createProject();
  const mainWorktree = project.worktrees[0];

  project.worktrees = [
    {
      ...mainWorktree,
      id: "worktree-collapsed-heavy",
      name: "collapsed-heavy",
      path: "/tmp/project-1-collapsed-heavy",
      position: { x: 1800, y: 0 },
      collapsed: true,
      terminals: [
        {
          ...mainWorktree.terminals[0],
          id: "terminal-heavy-1",
          title: "Heavy 1",
          span: { cols: 3, rows: 1 },
        },
        {
          ...mainWorktree.terminals[0],
          id: "terminal-heavy-2",
          title: "Heavy 2",
          span: { cols: 3, rows: 1 },
        },
      ],
    },
    {
      ...mainWorktree,
      id: "worktree-visible",
      name: "visible",
      path: "/tmp/project-1-visible",
      position: { x: 3200, y: 10 },
    },
  ];

  resetStore([project]);

  useProjectStore.getState().compactProjectWorktrees(project.id);

  const compactedProject = useProjectStore.getState().projects[0];
  assert.deepEqual(
    compactedProject.worktrees.map((worktree) => ({
      id: worktree.id,
      position: worktree.position,
    })),
    [
      { id: "worktree-collapsed-heavy", position: { x: 0, y: 0 } },
      { id: "worktree-visible", position: { x: 308, y: 0 } },
    ],
  );
  assert.equal(getProjectBounds(compactedProject).w, 992);
});

test("compactProjectWorktrees keeps pure visual order for all-collapsed worktrees", () => {
  const project = createProject();

  project.worktrees = [
    createEmptyWorktree(
      "worktree-feature-a",
      "feature-a",
      "/tmp/project-1-feature-a",
      1800,
      0,
    ),
    createEmptyWorktree(
      "worktree-feature-b",
      "feature-b",
      "/tmp/project-1-feature-b",
      1500,
      10,
    ),
    createEmptyWorktree("worktree-main", "main", "/tmp/project-1", 2200, 20),
    createEmptyWorktree(
      "worktree-feature-c",
      "feature-c",
      "/tmp/project-1-feature-c",
      2600,
      30,
    ),
    createEmptyWorktree(
      "worktree-feature-d",
      "feature-d",
      "/tmp/project-1-feature-d",
      3000,
      40,
    ),
    createEmptyWorktree(
      "worktree-feature-e",
      "feature-e",
      "/tmp/project-1-feature-e",
      3400,
      50,
    ),
    createEmptyWorktree(
      "worktree-feature-f",
      "feature-f",
      "/tmp/project-1-feature-f",
      3800,
      60,
    ),
  ];

  resetStore([project]);

  useProjectStore.getState().compactProjectWorktrees(project.id);

  const worktrees = useProjectStore.getState().projects[0].worktrees;
  assert.deepEqual(
    worktrees.map((worktree) => ({
      id: worktree.id,
      position: worktree.position,
    })),
    [
      { id: "worktree-feature-a", position: { x: 0, y: 0 } },
      { id: "worktree-feature-b", position: { x: 308, y: 0 } },
      { id: "worktree-main", position: { x: 616, y: 0 } },
      { id: "worktree-feature-c", position: { x: 924, y: 0 } },
      { id: "worktree-feature-d", position: { x: 1232, y: 0 } },
      { id: "worktree-feature-e", position: { x: 1540, y: 0 } },
      { id: "worktree-feature-f", position: { x: 0, y: 44 } },
    ],
  );
});

test("compactProjectWorktrees treats expanded empty worktrees as visible cards", () => {
  const project = createProject();

  project.worktrees = [
    {
      id: "worktree-empty",
      name: "empty",
      path: "/tmp/project-1-empty",
      position: { x: 2000, y: 0 },
      collapsed: false,
      terminals: [],
    },
    createEmptyWorktree(
      "worktree-collapsed",
      "collapsed",
      "/tmp/project-1-collapsed",
      2500,
      10,
    ),
    createEmptyWorktree(
      "worktree-collapsed-2",
      "collapsed-2",
      "/tmp/project-1-collapsed-2",
      2800,
      20,
    ),
  ];

  resetStore([project]);

  useProjectStore.getState().compactProjectWorktrees(project.id);

  const compactedProject = useProjectStore.getState().projects[0];
  assert.deepEqual(
    compactedProject.worktrees.map((worktree) => ({
      id: worktree.id,
      position: worktree.position,
    })),
    [
      { id: "worktree-empty", position: { x: 0, y: 0 } },
      { id: "worktree-collapsed", position: { x: 308, y: 0 } },
      { id: "worktree-collapsed-2", position: { x: 616, y: 0 } },
    ],
  );
  assert.equal(getProjectBounds(compactedProject).h, 180);
});

test("compactProjectWorktrees enables auto-compact without moving an already compact layout", () => {
  const project = createProject();
  const mainWorktree = {
    ...project.worktrees[0],
    position: { x: 0, y: 0 },
  };

  project.worktrees = [
    mainWorktree,
    createEmptyWorktree(
      "worktree-small-1",
      "small-1",
      "/tmp/project-1-small-1",
      668,
      0,
    ),
    createEmptyWorktree(
      "worktree-small-2",
      "small-2",
      "/tmp/project-1-small-2",
      976,
      0,
    ),
    {
      id: "worktree-wide",
      name: "wide",
      path: "/tmp/project-1-wide",
      position: { x: 0, y: 544 },
      collapsed: false,
      terminals: [
        {
          ...mainWorktree.terminals[0],
          id: "terminal-wide-1",
          title: "Wide 1",
        },
        {
          ...mainWorktree.terminals[0],
          id: "terminal-wide-2",
          title: "Wide 2",
        },
      ],
    },
  ];

  resetStore([project]);

  const beforeProjects = useProjectStore.getState().projects;
  const beforeProject = beforeProjects[0];

  let notifications = 0;
  const unsubscribe = useProjectStore.subscribe(() => {
    notifications += 1;
  });

  useProjectStore.getState().compactProjectWorktrees(project.id);
  unsubscribe();

  const afterProjects = useProjectStore.getState().projects;
  assert.equal(notifications, 1);
  assert.notStrictEqual(afterProjects, beforeProjects);
  assert.notStrictEqual(afterProjects[0], beforeProject);
  assert.equal(afterProjects[0].autoCompact, true);
  assert.deepEqual(
    afterProjects[0].worktrees.map((worktree) => worktree.position),
    beforeProject.worktrees.map((worktree) => worktree.position),
  );
  assert.strictEqual(afterProjects[0].worktrees[0], beforeProject.worktrees[0]);
  assert.strictEqual(afterProjects[0].worktrees[1], beforeProject.worktrees[1]);
  assert.strictEqual(afterProjects[0].worktrees[2], beforeProject.worktrees[2]);
  assert.strictEqual(afterProjects[0].worktrees[3], beforeProject.worktrees[3]);
});

test("getProjectBounds ignores stashed terminals when sizing worktrees", () => {
  const project = createProject();
  project.worktrees[0] = {
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
        stashed: true,
      },
    ],
  };

  assert.equal(getProjectBounds(project).w, 1332);
});
