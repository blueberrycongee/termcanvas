import test from "node:test";
import assert from "node:assert/strict";

import { useProjectStore } from "../src/stores/projectStore.ts";
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
              type: "shell",
              minimized: false,
              focused: true,
              ptyId: null,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
            {
              id: "terminal-2",
              title: "Terminal 2",
              type: "codex",
              minimized: false,
              focused: false,
              ptyId: null,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
            {
              id: "terminal-3",
              title: "Terminal 3",
              type: "claude",
              minimized: false,
              focused: false,
              ptyId: null,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
      ],
    },
    {
      id: "project-2",
      name: "Project Two",
      path: "/tmp/project-2",
      position: { x: 1000, y: 0 },
      collapsed: false,
      zIndex: 2,
      worktrees: [
        {
          id: "worktree-2",
          name: "main",
          path: "/tmp/project-2",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "terminal-4",
              title: "Terminal 4",
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
    },
  ];
}

function resetStore(projects = createProjects()) {
  useProjectStore.setState({
    projects,
    focusedProjectId: "project-1",
    focusedWorktreeId: "worktree-1",
  });
}

test("setFocusedTerminal only rewrites the affected terminals", () => {
  resetStore();

  const before = useProjectStore.getState().projects;
  const beforeProject1 = before[0];
  const beforeWorktree1 = beforeProject1.worktrees[0];
  const beforeTerminal1 = beforeWorktree1.terminals[0];
  const beforeTerminal2 = beforeWorktree1.terminals[1];
  const beforeTerminal3 = beforeWorktree1.terminals[2];
  const beforeProject2 = before[1];

  useProjectStore.getState().setFocusedTerminal("terminal-2", {
    focusComposer: false,
  });

  const state = useProjectStore.getState();
  const afterProject1 = state.projects[0];
  const afterWorktree1 = afterProject1.worktrees[0];

  assert.notStrictEqual(afterProject1, beforeProject1);
  assert.notStrictEqual(afterWorktree1, beforeWorktree1);
  assert.notStrictEqual(afterWorktree1.terminals[0], beforeTerminal1);
  assert.notStrictEqual(afterWorktree1.terminals[1], beforeTerminal2);
  assert.strictEqual(afterWorktree1.terminals[2], beforeTerminal3);
  assert.strictEqual(state.projects[1], beforeProject2);
  assert.equal(afterWorktree1.terminals[0].focused, false);
  assert.equal(afterWorktree1.terminals[1].focused, true);
  assert.equal(state.focusedProjectId, "project-1");
  assert.equal(state.focusedWorktreeId, "worktree-1");
});

test("clearFocus is a no-op when nothing is focused", () => {
  const projects = createProjects();
  projects[0].worktrees[0].terminals[0].focused = false;

  useProjectStore.setState({
    projects,
    focusedProjectId: null,
    focusedWorktreeId: null,
  });

  const beforeProjects = useProjectStore.getState().projects;
  let notifications = 0;
  const unsubscribe = useProjectStore.subscribe(() => {
    notifications += 1;
  });

  useProjectStore.getState().clearFocus();
  unsubscribe();

  const state = useProjectStore.getState();
  assert.equal(notifications, 0);
  assert.strictEqual(state.projects, beforeProjects);
  assert.equal(state.focusedProjectId, null);
  assert.equal(state.focusedWorktreeId, null);
});
