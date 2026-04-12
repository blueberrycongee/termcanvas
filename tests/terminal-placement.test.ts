import test from "node:test";
import assert from "node:assert/strict";

import { pickPlacement } from "../src/canvas/terminalPlacement.ts";
import type { ProjectData } from "../src/types/index.ts";

function makeProjects(): ProjectData[] {
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
          terminals: [
            {
              id: "parent",
              title: "parent",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: null,
              status: "idle",
              x: 100,
              y: 200,
              width: 400,
              height: 300,
              tags: [],
            },
          ],
        },
      ],
    },
  ];
}

test("pickPlacement places adjacent to parent terminal", () => {
  const projects = makeProjects();
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    parentTerminalId: "parent",
    width: 400,
    height: 300,
  });

  // 100 + 400 + 8 = 508 → snapped to 510
  assert.equal(result.x, 510);
  assert.equal(result.y, 200);
});

test("pickPlacement honors preferred position from right-click", () => {
  const projects = makeProjects();
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    preferredPosition: { x: 1234, y: 567 },
  });

  // Snapped to grid 10
  assert.equal(result.x, 1230);
  assert.equal(result.y, 570);
});

test("pickPlacement places to the right of sibling tiles when no parent given", () => {
  const projects = makeProjects();
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
  });

  // sibling x=100,w=400 → right=500 → x = 500 + 8 = 508 → snapped 510, y stays at sibling top
  assert.equal(result.x, 510);
  assert.equal(result.y, 200);
});

function makeWorktreeWithTiles(
  tiles: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>,
): ProjectData[] {
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
          terminals: tiles.map((t) => ({
            id: t.id,
            title: t.id,
            type: "shell",
            minimized: false,
            focused: false,
            ptyId: null,
            status: "idle",
            x: t.x,
            y: t.y,
            width: t.width,
            height: t.height,
            tags: [],
          })),
        },
      ],
    },
  ];
}

test("pickPlacement anchors to focused terminal in target worktree", () => {
  // When a terminal in the target worktree has focused=true, the new
  // terminal should be placed to its right, not at the viewport top-left.
  const projects = makeWorktreeWithTiles([
    { id: "t1", x: 0, y: 0, width: 400, height: 300 },
    { id: "t2", x: 410, y: 0, width: 400, height: 300 },
    { id: "t3", x: 820, y: 0, width: 400, height: 300 },
  ]);
  // Mark t2 (the middle one) as focused.
  projects[0].worktrees[0].terminals[1].focused = true;

  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    viewportRect: { x: 0, y: 0, w: 1600, h: 900 },
  });
  // t2: right = 410 + 400 = 810 → anchor x = 810 + 8 = 818 → snap 820, y = 0
  assert.equal(result.x, 820);
  assert.equal(result.y, 0);
});

test("pickPlacement falls back to rightmost sibling when no terminal focused", () => {
  // No terminal has focused=true → use the rightmost sibling anchor.
  const projects = makeWorktreeWithTiles([
    { id: "t1", x: 100, y: 200, width: 400, height: 300 },
    { id: "t2", x: 600, y: 200, width: 400, height: 300 },
  ]);
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    viewportRect: { x: 0, y: 0, w: 1600, h: 900 },
  });
  // rightmost t2: right = 1000 → x = 1000 + 8 = 1008 → snap 1010, y = 200
  assert.equal(result.x, 1010);
  assert.equal(result.y, 200);
});

test("pickPlacement falls back to project relative when target worktree empty", () => {
  // Target worktree w2 has no terminals. Another worktree w1 in the same
  // project has a terminal → anchor off that terminal.
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
          terminals: [
            {
              id: "t1",
              title: "t1",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: null,
              status: "idle",
              x: 200,
              y: 100,
              width: 400,
              height: 300,
              tags: [],
            },
          ],
        },
        {
          id: "w2",
          name: "feature",
          path: "/app-feature",
          terminals: [],
        },
      ],
    },
  ];
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w2",
    width: 400,
    height: 300,
  });
  // t1 right = 200 + 400 = 600 → anchor x = 600 + 8 = 608 → snap 610, y = 100
  assert.equal(result.x, 610);
  assert.equal(result.y, 100);
});

test("pickPlacement falls back to viewport center when project completely empty", () => {
  const projects: ProjectData[] = [
    {
      id: "p1",
      name: "App",
      path: "/app",
      worktrees: [{ id: "w1", name: "main", path: "/app", terminals: [] }],
    },
  ];
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    viewportRect: { x: 0, y: 0, w: 1600, h: 900 },
  });
  // center: x = (1600 - 400) / 2 = 600, y = (900 - 300) / 2 = 300
  assert.equal(result.x, 600);
  assert.equal(result.y, 300);
});

test("pickPlacement falls back to provided fallback when worktree empty and no viewport", () => {
  const projects: ProjectData[] = [
    {
      id: "p1",
      name: "App",
      path: "/app",
      worktrees: [{ id: "w1", name: "main", path: "/app", terminals: [] }],
    },
  ];
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    fallback: { x: 1000, y: 2000 },
  });

  assert.equal(result.x, 1000);
  assert.equal(result.y, 2000);
});
