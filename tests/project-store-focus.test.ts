import test from "node:test";
import assert from "node:assert/strict";

import { useProjectStore } from "../src/stores/projectStore.ts";
import { usePreferencesStore } from "../src/stores/preferencesStore.ts";
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

function installWindowMock() {
  const target = new EventTarget();
  const previousWindow = (globalThis as { window?: Window }).window;
  const mockWindow = target as Window;
  (globalThis as { window?: Window }).window = mockWindow;

  return () => {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = previousWindow;
    }
  };
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

test("setFocusedTerminal requests direct terminal input focus even when the composer is enabled", () => {
  resetStore();
  const restoreWindow = installWindowMock();
  const previousPreferences = usePreferencesStore.getState();
  let focusedComposer = 0;
  let focusedTerminalInput: string | null = null;

  try {
    usePreferencesStore.setState({ composerEnabled: true });
    window.addEventListener("termcanvas:focus-composer", () => {
      focusedComposer += 1;
    });
    window.addEventListener("termcanvas:focus-terminal-input", (event) => {
      focusedTerminalInput = (event as CustomEvent).detail;
    });

    useProjectStore.getState().setFocusedTerminal("terminal-2");

    assert.equal(focusedComposer, 0);
    assert.equal(focusedTerminalInput, "terminal-2");
  } finally {
    usePreferencesStore.setState(previousPreferences);
    restoreWindow();
  }
});

test("setFocusedTerminal can still request composer focus explicitly", () => {
  resetStore();
  const restoreWindow = installWindowMock();
  const previousPreferences = usePreferencesStore.getState();
  let focusedComposer = 0;
  let focusedTerminalInput = 0;

  try {
    usePreferencesStore.setState({ composerEnabled: true });
    window.addEventListener("termcanvas:focus-composer", () => {
      focusedComposer += 1;
    });
    window.addEventListener("termcanvas:focus-terminal-input", () => {
      focusedTerminalInput += 1;
    });

    useProjectStore.getState().setFocusedTerminal("terminal-2", {
      focusComposer: true,
    });

    assert.equal(focusedComposer, 1);
    assert.equal(focusedTerminalInput, 0);
  } finally {
    usePreferencesStore.setState(previousPreferences);
    restoreWindow();
  }
});

test("setFocusedTerminal requests direct terminal input focus when composer is disabled", () => {
  resetStore();
  const restoreWindow = installWindowMock();
  const previousPreferences = usePreferencesStore.getState();
  let focusedComposer = 0;
  let focusedTerminalInput: string | null = null;

  try {
    usePreferencesStore.setState({ composerEnabled: false });
    window.addEventListener("termcanvas:focus-composer", () => {
      focusedComposer += 1;
    });
    window.addEventListener("termcanvas:focus-terminal-input", (event) => {
      focusedTerminalInput = (event as CustomEvent).detail;
    });

    useProjectStore.getState().setFocusedTerminal("terminal-2");

    assert.equal(focusedComposer, 0);
    assert.equal(focusedTerminalInput, "terminal-2");
  } finally {
    usePreferencesStore.setState(previousPreferences);
    restoreWindow();
  }
});
