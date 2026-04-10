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

test("pickPlacement places below sibling tiles when no parent given", () => {
  const projects = makeProjects();
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
  });

  // sibling minY=200, bottom=500 → y = 500 + 8 = 508 → snapped 510
  assert.equal(result.x, 100);
  assert.equal(result.y, 510);
});

test("pickPlacement falls back to provided fallback when worktree empty", () => {
  const projects: ProjectData[] = [
    {
      id: "p1",
      name: "App",
      path: "/app",
      worktrees: [
        { id: "w1", name: "main", path: "/app", terminals: [] },
      ],
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
