import test from "node:test";
import assert from "node:assert/strict";
import { getWorktreeFocusOrder } from "../src/stores/projectFocus.ts";
import type { ProjectData } from "../src/types/index.ts";

test("getWorktreeFocusOrder returns all worktrees in project/worktree order", () => {
  const projects: ProjectData[] = [
    {
      id: "project-1",
      name: "Project 1",
      path: "/tmp/project-1",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 1,
      worktrees: [
        {
          id: "wt-1",
          name: "main",
          path: "/tmp/project-1",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [],
        },
        {
          id: "wt-2",
          name: "feature",
          path: "/tmp/project-1-feature",
          position: { x: 0, y: 200 },
          collapsed: false,
          terminals: [],
        },
      ],
    },
    {
      id: "project-2",
      name: "Project 2",
      path: "/tmp/project-2",
      position: { x: 500, y: 0 },
      collapsed: false,
      zIndex: 2,
      worktrees: [
        {
          id: "wt-3",
          name: "main",
          path: "/tmp/project-2",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [],
        },
      ],
    },
  ];

  assert.deepEqual(
    getWorktreeFocusOrder(projects).map((w) => w.worktreeId),
    ["wt-1", "wt-2", "wt-3"],
  );
});
