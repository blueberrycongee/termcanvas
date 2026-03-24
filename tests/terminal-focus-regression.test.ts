import test from "node:test";
import assert from "node:assert/strict";

import type { ProjectData } from "../src/types/index.ts";
import { createTerminal, findTerminalById, useProjectStore } from "../src/stores/projectStore.ts";
import { usePreferencesStore } from "../src/stores/preferencesStore.ts";
import {
  cancelScheduledTerminalFocus,
  scheduleTerminalFocus,
  type PendingFocusFrame,
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
  queue: Map<number, FrameRequestCallback>,
  cancelled: number[],
  fired: string[],
) {
  let nextId = 1;
  const pending: PendingFocusFrame = { current: null };
  const focus = () => fired.push(terminalId);

  const requestFrame = (callback: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  };

  const cancelFrame = (id: number) => {
    cancelled.push(id);
    queue.delete(id);
  };

  const syncFromStore = () => {
    const location = findTerminalById(useProjectStore.getState().projects, terminalId);
    const terminal = location?.terminal;
    const adapter = terminal ? getComposerAdapter(terminal.type) : null;
    const composerEnabled = usePreferencesStore.getState().composerEnabled;
    const shouldFocusXterm = !!terminal && terminal.focused && (!adapter || !composerEnabled);

    if (shouldFocusXterm) {
      scheduleTerminalFocus(focus, pending, requestFrame, cancelFrame);
    } else {
      cancelScheduledTerminalFocus(pending, cancelFrame);
    }
  };

  const unsubscribe = useProjectStore.subscribe(syncFromStore);
  const onFocusTerminalInput = (event: Event) => {
    if ((event as CustomEvent).detail === terminalId) {
      scheduleTerminalFocus(focus, pending, requestFrame, cancelFrame);
    }
  };

  window.addEventListener("termcanvas:focus-terminal-input", onFocusTerminalInput);

  return () => {
    unsubscribe();
    window.removeEventListener("termcanvas:focus-terminal-input", onFocusTerminalInput);
    cancelScheduledTerminalFocus(pending, cancelFrame);
  };
}

test("queued terminal input focus is cancelled when worktree focus replaces a newly focused terminal before the next frame", () => {
  const restoreWindow = installWindowMock();
  const previousProjectState = useProjectStore.getState();
  const previousPreferences = usePreferencesStore.getState();

  const queue = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
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
      queue,
      cancelled,
      fired,
    );

    try {
      useProjectStore.getState().setFocusedTerminal(terminalBId);
      assert.equal(queue.size, 1);

      useProjectStore.getState().setFocusedWorktree(projectAId, worktreeAId);

      assert.equal(queue.size, 0);
      assert.deepEqual(fired, []);
      assert.deepEqual(cancelled, [1, 2]);
    } finally {
      detach();
    }
  } finally {
    useProjectStore.setState(previousProjectState);
    usePreferencesStore.setState(previousPreferences);
    restoreWindow();
  }
});
