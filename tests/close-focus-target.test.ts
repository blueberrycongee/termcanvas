import test from "node:test";
import assert from "node:assert/strict";

import { pickCloseFocusTarget } from "../src/canvas/closeFocusTarget.ts";
import type { ProjectData, TerminalData } from "../src/types/index.ts";

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

function singleWorktree(terminals: TerminalData[]): ProjectData[] {
  return [
    {
      id: "p1",
      name: "App",
      path: "/app",
      worktrees: [
        { id: "w1", name: "main", path: "/app", terminals },
      ],
    },
  ];
}

test("picks the row-aligned left sibling, mirroring cmd+t insertion", () => {
  // cmd+t inserted "b" at (a.right + gap, a.y). cmd+d on b should land on a.
  const projects = singleWorktree([
    makeTerminal("a", 0, 0),
    makeTerminal("b", 408, 0),
  ]);

  const next = pickCloseFocusTarget(projects, "b");
  assert.equal(next, "a");
});

test("prefers same-row left over closer-but-different-row", () => {
  const projects = singleWorktree([
    makeTerminal("row-aligned-far", 0, 0),
    makeTerminal("other-row-near", 350, 400), // closer center but different row
    makeTerminal("closed", 800, 0),
  ]);

  const next = pickCloseFocusTarget(projects, "closed");
  assert.equal(next, "row-aligned-far");
});

test("falls back to any-row left sibling when no row-aligned candidate exists", () => {
  const projects = singleWorktree([
    makeTerminal("upper-left", 0, 0),
    makeTerminal("lower-left", 0, 400),
    makeTerminal("closed", 800, 800),
  ]);

  const next = pickCloseFocusTarget(projects, "closed");
  // both are to the left; lower-left has y closer to closed.y -> wins
  assert.equal(next, "lower-left");
});

test("falls back to nearest sibling in same worktree when nothing is to the left", () => {
  const projects = singleWorktree([
    makeTerminal("closed", 0, 0),
    makeTerminal("right-near", 408, 0),
    makeTerminal("right-far", 1200, 0),
  ]);

  const next = pickCloseFocusTarget(projects, "closed");
  assert.equal(next, "right-near");
});

test("falls back to same-project sibling worktree, not other projects", () => {
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
          terminals: [makeTerminal("closed", 0, 0)],
        },
        {
          id: "w2",
          name: "feature",
          path: "/app-f",
          terminals: [makeTerminal("sibling-worktree", 1000, 0)],
        },
      ],
    },
    {
      id: "p2",
      name: "Other",
      path: "/other",
      worktrees: [
        {
          id: "w3",
          name: "main",
          path: "/other",
          terminals: [makeTerminal("other-project", 100, 100)],
        },
      ],
    },
  ];

  const next = pickCloseFocusTarget(projects, "closed");
  // even though other-project is spatially much closer, project-locality wins
  assert.equal(next, "sibling-worktree");
});

test("crosses project lines only when the closed terminal's project is now empty", () => {
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
          terminals: [makeTerminal("closed", 0, 0)],
        },
      ],
    },
    {
      id: "p2",
      name: "Other",
      path: "/other",
      worktrees: [
        {
          id: "w2",
          name: "main",
          path: "/other",
          terminals: [makeTerminal("survivor", 1000, 1000)],
        },
      ],
    },
  ];

  const next = pickCloseFocusTarget(projects, "closed");
  assert.equal(next, "survivor");
});

test("returns null when nothing else exists", () => {
  const projects = singleWorktree([makeTerminal("only", 0, 0)]);
  const next = pickCloseFocusTarget(projects, "only");
  assert.equal(next, null);
});

test("ignores stashed and minimized terminals", () => {
  const projects = singleWorktree([
    makeTerminal("hidden-left", 0, 0, { stashed: true }),
    makeTerminal("visible-left", 200, 0),
    makeTerminal("closed", 800, 0),
    makeTerminal("min-right", 1200, 0, { minimized: true }),
  ]);

  const next = pickCloseFocusTarget(projects, "closed");
  assert.equal(next, "visible-left");
});

test("cmd+t / cmd+d round-trip: closing a freshly inserted tile lands on its anchor", () => {
  // simulate: focus 'a', cmd+t inserts 'b' at (a.right + gap, a.y), focus moves to b
  const a = makeTerminal("a", 100, 100);
  const b = makeTerminal("b", 100 + 400 + 8, 100); // ADJACENCY_GAP=8 in placement
  const projects = singleWorktree([a, b]);
  const next = pickCloseFocusTarget(projects, "b");
  assert.equal(next, "a");
});
