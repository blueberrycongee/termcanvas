import test from "node:test";
import assert from "node:assert/strict";

import {
  getSpatialTerminalOrder,
  normalizeProjectsFocus,
} from "../src/stores/projectFocus.ts";
import type { ProjectData, TerminalData } from "../src/types/index.ts";

function createProjects(): ProjectData[] {
  return [
    {
      id: "project-1",
      name: "Project One",
      path: "/tmp/project-1",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 1,
      worktrees: [
        {
          id: "worktree-1",
          name: "main",
          path: "/tmp/project-1",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "terminal-1",
              title: "Terminal 1",
              type: "claude",
              minimized: false,
              focused: false,
              ptyId: 101,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
        {
          id: "worktree-2",
          name: "feature",
          path: "/tmp/project-1-feature",
          position: { x: 10, y: 10 },
          collapsed: false,
          terminals: [
            {
              id: "terminal-2",
              title: "Terminal 2",
              type: "codex",
              minimized: false,
              focused: true,
              ptyId: 102,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
      ],
    },
  ];
}

test("normalizeProjectsFocus restores focused project and worktree from a focused terminal", () => {
  const normalized = normalizeProjectsFocus(createProjects());

  assert.equal(normalized.focusedProjectId, "project-1");
  assert.equal(normalized.focusedWorktreeId, "worktree-2");
});

test("normalizeProjectsFocus clears store focus when restored projects have no focused terminal", () => {
  const projects = createProjects();
  projects[0].worktrees[1].terminals[0].focused = false;

  const normalized = normalizeProjectsFocus(projects);

  assert.equal(normalized.focusedProjectId, null);
  assert.equal(normalized.focusedWorktreeId, null);
});

test("normalizeProjectsFocus reduces multiple focused terminals to one canonical focus", () => {
  const projects = createProjects();
  projects[0].worktrees[0].terminals[0].focused = true;

  const normalized = normalizeProjectsFocus(projects);

  assert.equal(normalized.focusedProjectId, "project-1");
  assert.equal(normalized.focusedWorktreeId, "worktree-1");
  assert.deepEqual(
    normalized.projects[0].worktrees.map((worktree) =>
      worktree.terminals.map((terminal) => terminal.focused),
    ),
    [[true], [false]],
  );
});

test("normalizeProjectsFocus ignores focused terminals hidden by a collapsed worktree", () => {
  const projects = createProjects();
  projects[0].worktrees[1].collapsed = true;

  const normalized = normalizeProjectsFocus(projects);

  assert.equal(normalized.focusedProjectId, null);
  assert.equal(normalized.focusedWorktreeId, null);
  assert.equal(normalized.projects[0].worktrees[1].terminals[0].focused, false);
});

test("normalizeProjectsFocus ignores focused terminals hidden by a collapsed project", () => {
  const projects = createProjects();
  projects[0].collapsed = true;

  const normalized = normalizeProjectsFocus(projects);

  assert.equal(normalized.focusedProjectId, null);
  assert.equal(normalized.focusedWorktreeId, null);
  assert.equal(normalized.projects[0].worktrees[1].terminals[0].focused, false);
});

function makeTerminal(
  id: string,
  x: number,
  y: number,
  overrides: Partial<TerminalData> = {},
): TerminalData {
  return {
    id,
    title: id,
    type: "shell",
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    x,
    y,
    width: 400,
    height: 300,
    tags: [],
    ...overrides,
  };
}

function spatialFixture(terminals: TerminalData[]): ProjectData[] {
  return [
    {
      id: "p1",
      name: "App",
      path: "/app",
      worktrees: [
        {
          id: "w1",
          name: "main",
          path: "/app",
          terminals,
        },
      ],
    },
  ];
}

test("getSpatialTerminalOrder sorts by y then x", () => {
  const projects = spatialFixture([
    makeTerminal("c", 500, 300),
    makeTerminal("a", 100, 0),
    makeTerminal("b", 600, 0),
    makeTerminal("d", 100, 300),
  ]);

  const order = getSpatialTerminalOrder(projects).map((i) => i.terminalId);

  // row y=0: a (x=100), b (x=600); row y=300: d (x=100), c (x=500)
  assert.deepEqual(order, ["a", "b", "d", "c"]);
});

test("getSpatialTerminalOrder uses terminalId as deterministic tiebreaker", () => {
  const projects = spatialFixture([
    makeTerminal("z", 0, 0),
    makeTerminal("a", 0, 0),
    makeTerminal("m", 0, 0),
  ]);

  const order = getSpatialTerminalOrder(projects).map((i) => i.terminalId);

  assert.deepEqual(order, ["a", "m", "z"]);
});

test("getSpatialTerminalOrder skips stashed and minimized terminals", () => {
  const projects = spatialFixture([
    makeTerminal("visible-1", 0, 0),
    makeTerminal("hidden-stashed", 10, 0, { stashed: true }),
    makeTerminal("hidden-minimized", 20, 0, { minimized: true }),
    makeTerminal("visible-2", 30, 0),
  ]);

  const order = getSpatialTerminalOrder(projects).map((i) => i.terminalId);

  assert.deepEqual(order, ["visible-1", "visible-2"]);
});

test("getSpatialTerminalOrder ignores array insertion order across worktrees", () => {
  // Terminals from later worktrees can still come first if they live
  // physically higher / further left on the canvas.
  const projects: ProjectData[] = [
    {
      id: "p1",
      name: "App",
      path: "/app",
      worktrees: [
        {
          id: "w1",
          name: "main",
          path: "/app",
          terminals: [makeTerminal("late-but-top-left", 0, 0)],
        },
        {
          id: "w2",
          name: "feature",
          path: "/app-feature",
          terminals: [makeTerminal("early-but-bottom-right", 1000, 800)],
        },
      ],
    },
  ];

  const order = getSpatialTerminalOrder(projects).map((i) => i.terminalId);
  assert.deepEqual(order, ["late-but-top-left", "early-but-bottom-right"]);
});
