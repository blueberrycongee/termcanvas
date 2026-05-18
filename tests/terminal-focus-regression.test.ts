import test from "node:test";
import assert from "node:assert/strict";

import type { ProjectData } from "../src/types/index.ts";
import { createTerminal, findTerminalById, useProjectStore } from "../src/stores/projectStore.ts";
import { usePreferencesStore } from "../src/stores/preferencesStore.ts";
import {
  cancelScheduledTerminalFocus,
  createPendingFocus,
  scheduleTerminalFocus,
  type PendingFocus,
} from "../src/terminal/focusScheduler.ts";
import { getComposerAdapter } from "../src/terminal/cliConfig.ts";

function createTestProjects(): {
  projects: ProjectData[];
  terminalAId: string;
  terminalBId: string;
  projectAId: string;
  worktreeAId: string;
} {
  const terminalA = createTerminal("shell", "Terminal A");
  terminalA.id = "terminal-a";
  const terminalB = createTerminal("shell", "Terminal B");
  terminalB.id = "terminal-b";

  const projectAId = "project-a";
  const worktreeAId = "worktree-a";

  return {
    terminalAId: terminalA.id,
    terminalBId: terminalB.id,
    projectAId,
    worktreeAId,
    projects: [
      {
        id: projectAId,
        name: "Project A",
        path: "/tmp/project-a",
        position: { x: 0, y: 0 },
        collapsed: false,
        zIndex: 1,
        worktrees: [
          {
            id: worktreeAId,
            name: "main",
            path: "/tmp/project-a",
            position: { x: 0, y: 0 },
            collapsed: false,
            terminals: [terminalA],
          },
        ],
      },
      {
        id: "project-b",
        name: "Project B",
        path: "/tmp/project-b",
        position: { x: 400, y: 0 },
        collapsed: false,
        zIndex: 2,
        worktrees: [
          {
            id: "worktree-b",
            name: "main",
            path: "/tmp/project-b",
            position: { x: 0, y: 0 },
            collapsed: false,
            terminals: [terminalB],
          },
        ],
      },
    ],
  };
}

function installWindowMock() {
  const target = new EventTarget();
  const previousWindow = (globalThis as { window?: Window }).window;
  const mockWindow = Object.assign(target, {
    termcanvas: {
      app: { platform: "darwin" as const },
    },
  }) as Window;
  (globalThis as { window?: Window }).window = mockWindow;

  return () => {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = previousWindow;
    }
  };
}

function attachTerminalFocusHarness(
  terminalId: string,
  microtasks: Array<() => void>,
  fired: string[],
) {
  const pending: PendingFocus = createPendingFocus();
  const focus = () => {
    fired.push(terminalId);
    return true;
  };

  const options = {
    requestMicrotask: (cb: () => void) => microtasks.push(cb),
  };

  const syncFromStore = () => {
    const location = findTerminalById(useProjectStore.getState().projects, terminalId);
    const terminal = location?.terminal;
    const adapter = terminal ? getComposerAdapter(terminal.type) : null;
    const composerEnabled = usePreferencesStore.getState().composerEnabled;
    const shouldFocusXterm = !!terminal && terminal.focused && (!adapter || !composerEnabled);

    if (shouldFocusXterm) {
      scheduleTerminalFocus(focus, pending, options);
    } else {
      cancelScheduledTerminalFocus(pending);
    }
  };

  const unsubscribe = useProjectStore.subscribe(syncFromStore);
  const onFocusXterm = (event: Event) => {
    if ((event as CustomEvent).detail === terminalId) {
      scheduleTerminalFocus(focus, pending, options);
    }
  };

  window.addEventListener("termcanvas:focus-xterm", onFocusXterm);

  return () => {
    unsubscribe();
    window.removeEventListener("termcanvas:focus-xterm", onFocusXterm);
    cancelScheduledTerminalFocus(pending);
  };
}

test("queued xterm focus is cancelled when worktree focus replaces a newly focused terminal before the next frame", () => {
  const restoreWindow = installWindowMock();
  const previousProjectState = useProjectStore.getState();
  const previousPreferences = usePreferencesStore.getState();

  const microtasks: Array<() => void> = [];
  const fired: string[] = [];

  try {
    const {
      projects,
      terminalBId,
      projectAId,
      worktreeAId,
    } = createTestProjects();

    useProjectStore.setState({
      projects,
      focusedProjectId: null,
      focusedWorktreeId: null,
    });
    usePreferencesStore.setState({ composerEnabled: false });

    const detach = attachTerminalFocusHarness(
      terminalBId,
      microtasks,
      fired,
    );

    try {
      useProjectStore.getState().setFocusedTerminal(terminalBId);
      // The first-tier microtask was queued (possibly multiple times if the
      // store subscriber fires on each field change — each scheduleTerminalFocus
      // call enqueues a fresh microtask while bumping generation, so any stale
      // ones become no-ops).
      assert.ok(microtasks.length >= 1, `expected >= 1 microtask, got ${microtasks.length}`);

      // Switching projects re-syncs the harness; cancellation bumps
      // generation so the queued microtask must no-op when flushed.
      useProjectStore.getState().setFocusedWorktree(projectAId, worktreeAId);

      while (microtasks.length > 0) {
        microtasks.shift()!();
      }

      assert.deepEqual(fired, []);
    } finally {
      detach();
    }
  } finally {
    useProjectStore.setState(previousProjectState);
    usePreferencesStore.setState(previousPreferences);
    restoreWindow();
  }
});
