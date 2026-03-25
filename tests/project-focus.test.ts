import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProjectsFocus } from "../src/stores/projectFocus.ts";
import type { ProjectData } from "../src/types/index.ts";

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
