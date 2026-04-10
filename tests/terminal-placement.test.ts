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
  tiles: Array<{ id: string; x: number; y: number; width: number; height: number }>,
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

test("pickPlacement fills viewport row-major when viewportRect provided", () => {
  // One existing tile in the top-left of the viewport. The next cmd+t
  // should drop the new tile immediately to its right (same row), not
  // beyond the rightmost sibling's right edge.
  const projects = makeWorktreeWithTiles([
    { id: "t1", x: 0, y: 0, width: 400, height: 300 },
  ]);
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    viewportRect: { x: 0, y: 0, w: 1600, h: 900 },
  });
  // collider right = 400, next x = snap(400 + 8) = 410
  assert.equal(result.x, 410);
  assert.equal(result.y, 0);
});

test("pickPlacement wraps to next row when the current row is full", () => {
  // Row 0 is fully occupied across the viewport width. The scan should
  // wrap to row 1 (y = height + gap snapped).
  const projects = makeWorktreeWithTiles([
    { id: "t1", x: 0, y: 0, width: 800, height: 300 },
    { id: "t2", x: 810, y: 0, width: 800, height: 300 },
  ]);
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    viewportRect: { x: 0, y: 0, w: 1600, h: 900 },
  });
  // next row y = snap(300 + 8) = 310
  assert.equal(result.x, 0);
  assert.equal(result.y, 310);
});

test("pickPlacement skips past a wide resized tile without losing the row", () => {
  // A user-resized wide tile blocks most of the row but leaves room at
  // its right. Scan should jump past the wide tile and place the new
  // tile in the remaining gap, still in row 0.
  const projects = makeWorktreeWithTiles([
    { id: "wide", x: 0, y: 0, width: 1100, height: 300 },
  ]);
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    viewportRect: { x: 0, y: 0, w: 1600, h: 900 },
  });
  // skip past wide tile: x = snap(1100 + 8) = 1110, still fits (1110 + 400 = 1510 <= 1600)
  assert.equal(result.x, 1110);
  assert.equal(result.y, 0);
});

test("pickPlacement falls back to rightmost sibling when viewport is full", () => {
  // Every row in the viewport is saturated → grid scan returns null → fall
  // back to the rightmost-sibling anchor (which can extend outside the
  // viewport).
  const projects = makeWorktreeWithTiles([
    { id: "t1", x: 0, y: 0, width: 800, height: 900 },
    { id: "t2", x: 810, y: 0, width: 800, height: 900 },
  ]);
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    viewportRect: { x: 0, y: 0, w: 1600, h: 900 },
  });
  // rightmost sibling: t2 (x=810, w=800, right=1610) → x = 1618 → snap 1620, y = 0
  assert.equal(result.x, 1620);
  assert.equal(result.y, 0);
});

test("pickPlacement falls back to rightmost when viewport smaller than tile", () => {
  // Viewport is too tight to fit even one default tile → grid scan skipped,
  // fall back to rightmost-sibling anchor.
  const projects = makeWorktreeWithTiles([
    { id: "t1", x: 100, y: 200, width: 400, height: 300 },
  ]);
  const result = pickPlacement({
    projects,
    projectId: "p1",
    worktreeId: "w1",
    width: 400,
    height: 300,
    viewportRect: { x: 0, y: 0, w: 200, h: 200 },
  });
  assert.equal(result.x, 510);
  assert.equal(result.y, 200);
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
