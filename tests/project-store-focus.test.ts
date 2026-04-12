import test from "node:test";
import assert from "node:assert/strict";

import {
  addScannedProjectAndFocus,
  ensureTerminalCreationTarget,
} from "../src/projects/projectCreation.ts";
import { useProjectStore } from "../src/stores/projectStore.ts";
import { usePreferencesStore } from "../src/stores/preferencesStore.ts";
import { useTerminalRuntimeStateStore } from "../src/stores/terminalRuntimeStateStore.ts";
import type { ProjectData } from "../src/types/index.ts";

function createTerminalFixture(
  id: string,
  title: string,
  type: string = "shell",
  focused: boolean = false,
) {
  return {
    id,
    title,
    type: type as "shell" | "claude" | "codex",
    minimized: false,
    focused,
    ptyId: null,
    status: "idle" as const,
    x: 0,
    y: 0,
    width: 640,
    height: 480,
    tags: [],
  };
}

function createProjects(): ProjectData[] {
  return [
    {
      id: "project-1",
      name: "Project One",
      path: "/tmp/project-1",
      worktrees: [
        {
          id: "worktree-1",
          name: "main",
          path: "/tmp/project-1",
          terminals: [
            createTerminalFixture("terminal-1", "Terminal 1", "shell", true),
            createTerminalFixture("terminal-2", "Terminal 2", "codex"),
            createTerminalFixture("terminal-3", "Terminal 3", "claude"),
          ],
        },
      ],
    },
    {
      id: "project-2",
      name: "Project Two",
      path: "/tmp/project-2",
      worktrees: [
        {
          id: "worktree-2",
          name: "main",
          path: "/tmp/project-2",
          terminals: [createTerminalFixture("terminal-4", "Terminal 4")],
        },
      ],
    },
  ];
}

function resetStore(projects = createProjects()) {
  useTerminalRuntimeStateStore.getState().reset();
  useProjectStore.setState({
    projects,
    focusedProjectId: "project-1",
    focusedWorktreeId: "worktree-1",
  });
}

function installWindowMock() {
  const target = new EventTarget();
  const previousWindow = (globalThis as { window?: Window }).window;
  (globalThis as { window?: Window }).window = target as Window;

  return () => {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
      return;
    }
    (globalThis as { window?: Window }).window = previousWindow;
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

test("setFocusedTerminal can skip input focus side effects", () => {
  resetStore();
  const restoreWindow = installWindowMock();
  const previousPreferences = usePreferencesStore.getState();
  const focusedComposerEvents: string[] = [];
  const focusedXtermEvents: string[] = [];

  const onFocusComposer = () => focusedComposerEvents.push("composer");
  const onFocusXterm = (event: Event) => {
    focusedXtermEvents.push(String((event as CustomEvent).detail ?? ""));
  };

  try {
    usePreferencesStore.setState({ composerEnabled: true });
    window.addEventListener("termcanvas:focus-composer", onFocusComposer);
    window.addEventListener("termcanvas:focus-xterm", onFocusXterm);

    useProjectStore.getState().setFocusedTerminal("terminal-2", {
      focusInput: false,
    });

    const state = useProjectStore.getState();
    assert.equal(state.projects[0].worktrees[0].terminals[1].focused, true);
    assert.deepEqual(focusedComposerEvents, []);
    assert.deepEqual(focusedXtermEvents, []);
  } finally {
    window.removeEventListener("termcanvas:focus-composer", onFocusComposer);
    window.removeEventListener("termcanvas:focus-xterm", onFocusXterm);
    usePreferencesStore.setState(previousPreferences);
    restoreWindow();
  }
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

test("setFocusedTerminal ignores unknown terminal ids", () => {
  resetStore();

  const before = useProjectStore.getState();

  useProjectStore.getState().setFocusedTerminal("missing-terminal", {
    focusComposer: false,
  });

  const state = useProjectStore.getState();
  assert.strictEqual(state.projects, before.projects);
  assert.equal(state.focusedProjectId, before.focusedProjectId);
  assert.equal(state.focusedWorktreeId, before.focusedWorktreeId);
  assert.equal(state.projects[0].worktrees[0].terminals[0].focused, true);
});

test("setFocusedWorktree ignores unknown worktree ids", () => {
  resetStore();

  const before = useProjectStore.getState();

  useProjectStore
    .getState()
    .setFocusedWorktree("project-1", "missing-worktree");

  const state = useProjectStore.getState();
  assert.strictEqual(state.projects, before.projects);
  assert.equal(state.focusedProjectId, before.focusedProjectId);
  assert.equal(state.focusedWorktreeId, before.focusedWorktreeId);
  assert.equal(state.projects[0].worktrees[0].terminals[0].focused, true);
});

test("clearFocus clears focused terminal flags", () => {
  resetStore();

  useProjectStore.getState().clearFocus();

  const state = useProjectStore.getState();
  assert.equal(state.focusedProjectId, null);
  assert.equal(state.focusedWorktreeId, null);
  assert.equal(state.projects[0].worktrees[0].terminals[0].focused, false);
});

test("removeProject clears focus when the focused project is deleted", () => {
  resetStore();

  useProjectStore.getState().removeProject("project-1");

  const state = useProjectStore.getState();
  assert.equal(state.focusedProjectId, null);
  assert.equal(state.focusedWorktreeId, null);
  assert.equal(
    state.projects.some((project) => project.id === "project-1"),
    false,
  );
});

test("removeProject clears descendant terminal runtime state", () => {
  resetStore();
  useTerminalRuntimeStateStore
    .getState()
    .setSessionId("terminal-1", "session-1");
  useTerminalRuntimeStateStore.getState().setStatus("terminal-2", "running");

  useProjectStore.getState().removeProject("project-1");

  assert.deepEqual(useTerminalRuntimeStateStore.getState().terminals, {});
});

test("removeWorktree clears only the deleted worktree focus", () => {
  resetStore();

  useProjectStore.getState().removeWorktree("project-1", "worktree-1");

  const state = useProjectStore.getState();
  assert.equal(state.focusedProjectId, "project-1");
  assert.equal(state.focusedWorktreeId, null);
  assert.equal(state.projects[0].worktrees.length, 0);
});

test("removeWorktree clears runtime state for removed terminals", () => {
  resetStore();
  useTerminalRuntimeStateStore
    .getState()
    .setSessionId("terminal-1", "session-1");
  useTerminalRuntimeStateStore.getState().setStatus("terminal-2", "running");

  useProjectStore.getState().removeWorktree("project-1", "worktree-1");

  assert.deepEqual(useTerminalRuntimeStateStore.getState().terminals, {});
});

test("addScannedProjectAndFocus focuses the first worktree of the created project", () => {
  useProjectStore.setState({
    projects: [],
    focusedProjectId: null,
    focusedWorktreeId: null,
  });

  const createdProject = addScannedProjectAndFocus({
    name: "Project One",
    path: "/tmp/project-one",
    worktrees: [
      { path: "/tmp/project-one", branch: "main", isMain: true },
      { path: "/tmp/project-one-feature", branch: "feature", isMain: false },
    ],
  });

  const state = useProjectStore.getState();
  assert.equal(state.projects.length, 1);
  assert.equal(state.focusedProjectId, createdProject.id);
  assert.equal(state.focusedWorktreeId, createdProject.worktrees[0].id);
});

test("ensureTerminalCreationTarget creates a default home project when the store is empty", () => {
  useProjectStore.setState({
    projects: [],
    focusedProjectId: null,
    focusedWorktreeId: null,
  });

  const target = ensureTerminalCreationTarget("/Users/tester");
  const state = useProjectStore.getState();

  assert.ok(target);
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].path, "/Users/tester");
  assert.equal(state.projects[0].worktrees.length, 1);
  assert.equal(state.projects[0].worktrees[0].path, "/Users/tester");
  assert.equal(state.focusedProjectId, target.projectId);
  assert.equal(state.focusedWorktreeId, target.worktreeId);
});

test("ensureTerminalCreationTarget returns the focused worktree when one already exists", () => {
  resetStore();

  const before = useProjectStore.getState().projects;
  const target = ensureTerminalCreationTarget("/Users/tester");
  const state = useProjectStore.getState();

  assert.ok(target);
  assert.strictEqual(state.projects, before);
  assert.equal(target.projectId, "project-1");
  assert.equal(target.worktreeId, "worktree-1");
});
