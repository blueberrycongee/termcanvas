import test from "node:test";
import assert from "node:assert/strict";

function installActionGlobals() {
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

test("createTerminalInScene adds a terminal and focusTerminalInScene marks it focused", async () => {
  installActionGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const {
    createTerminalInScene,
    focusTerminalInScene,
  } = await import("../src/actions/terminalSceneActions.ts");
  const previousState = useProjectStore.getState();

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
              terminals: [],
            },
          ],
        },
      ],
    });

    const terminal = createTerminalInScene({
      projectId: "project-1",
      worktreeId: "worktree-1",
      type: "shell",
    });
    focusTerminalInScene(terminal.id);

    const terminals =
      useProjectStore.getState().projects[0].worktrees[0].terminals;
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].id, terminal.id);
    assert.equal(terminals[0].focused, true);
  } finally {
    useProjectStore.setState(previousState);
  }
});

test("closeTerminalInScene destroys runtime and removes the terminal from the scene", async () => {
  const mockWindow = installActionGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const {
    destroyAllTerminalRuntimes,
    ensureTerminalRuntime,
    useTerminalRuntimeStore,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const {
    closeTerminalInScene,
  } = await import("../src/actions/terminalSceneActions.ts");
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

    closeTerminalInScene("project-1", "worktree-1", "terminal-1");

    assert.equal(
      useProjectStore.getState().projects[0].worktrees[0].terminals.length,
      0,
    );
    assert.equal(
      useTerminalRuntimeStore.getState().terminals["terminal-1"],
      undefined,
    );
    assert.equal(
      useTerminalRuntimeStateStore.getState().terminals["terminal-1"],
      undefined,
    );
  } finally {
    destroyAllTerminalRuntimes();
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousState);
  }
});
