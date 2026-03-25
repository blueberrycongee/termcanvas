import test from "node:test";
import assert from "node:assert/strict";

function installRuntimeGlobals() {
  const storage = new Map<string, string>();
  const navigator = {
    language: "en-US",
    userAgent: "node-test",
    clipboard: {
      writeText: async () => {},
    },
  };
  const target = new EventTarget();
  const mockWindow = Object.assign(target, {
    navigator,
    termcanvas: undefined as unknown,
  }) as Window & { termcanvas: unknown };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      },
    },
  });

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigator,
  });

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: mockWindow,
  });

  return mockWindow;
}

test("destroyTerminalRuntime clears persisted pty ids from project state", async () => {
  const mockWindow = installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const {
    destroyAllTerminalRuntimes,
    ensureTerminalRuntime,
    destroyTerminalRuntime,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const previousState = useProjectStore.getState();

  destroyAllTerminalRuntimes();

  try {
    useProjectStore.setState({
      focusedProjectId: "project-1",
      focusedWorktreeId: "worktree-1",
      projects: [
        {
          id: "project-1",
          name: "Project One",
          path: "/tmp/project-1",
          position: { x: 0, y: 0 },
          collapsed: false,
          zIndex: 0,
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
                  title: "Terminal",
                  type: "shell",
                  minimized: false,
                  focused: true,
                  ptyId: 42,
                  status: "running",
                  span: { cols: 1, rows: 1 },
                },
              ],
            },
          ],
        },
      ],
    });

    ensureTerminalRuntime({
      projectId: "project-1",
      terminal: useProjectStore.getState().projects[0].worktrees[0].terminals[0],
      worktreeId: "worktree-1",
      worktreePath: "/tmp/project-1",
    });

    mockWindow.termcanvas = {
      terminal: {
        destroy: async () => {},
      },
    };

    destroyTerminalRuntime("terminal-1");

    assert.equal(
      useProjectStore.getState().projects[0].worktrees[0].terminals[0].ptyId,
      null,
    );
  } finally {
    destroyAllTerminalRuntimes();
    useProjectStore.setState(previousState);
  }
});
