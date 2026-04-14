import test from "node:test";
import assert from "node:assert/strict";

// Node.js does not provide CustomEvent globally — polyfill it for tests.
if (typeof globalThis.CustomEvent === "undefined") {
  (globalThis as Record<string, unknown>).CustomEvent = class CustomEvent<
    T = unknown,
  > extends Event {
    detail: T;
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type, init);
      this.detail = init?.detail as T;
    }
  };
}

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

test("buildWorktreeGroupMove keeps a stable formation and commit only moves that worktree", async () => {
  installActionGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const {
    buildWorktreeGroupMove,
    commitWorktreeGroupMove,
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
          worktrees: [
            {
              id: "worktree-1",
              name: "main",
              path: "/tmp/project-1",
              terminals: [
                {
                  id: "terminal-1",
                  title: "Terminal 1",
                  type: "shell",
                  minimized: false,
                  focused: false,
                  ptyId: 1,
                  status: "running",
                  x: 100,
                  y: 200,
                  width: 400,
                  height: 300,
                  tags: [],
                },
                {
                  id: "terminal-2",
                  title: "Terminal 2",
                  type: "claude",
                  minimized: false,
                  focused: false,
                  ptyId: 2,
                  status: "running",
                  x: 560,
                  y: 240,
                  width: 400,
                  height: 300,
                  tags: [],
                },
                {
                  id: "terminal-stashed",
                  title: "Stashed",
                  type: "shell",
                  minimized: false,
                  focused: false,
                  ptyId: 3,
                  status: "idle",
                  x: 900,
                  y: 900,
                  width: 400,
                  height: 300,
                  tags: [],
                  stashed: true,
                },
              ],
            },
            {
              id: "worktree-2",
              name: "feature",
              path: "/tmp/project-1-feature",
              terminals: [
                {
                  id: "terminal-3",
                  title: "Terminal 3",
                  type: "shell",
                  minimized: false,
                  focused: false,
                  ptyId: 4,
                  status: "running",
                  x: 1600,
                  y: 400,
                  width: 400,
                  height: 300,
                  tags: [],
                },
              ],
            },
          ],
        },
      ],
    });

    const preview = buildWorktreeGroupMove("project-1", "worktree-1", 130, -70);
    assert.ok(preview);
    assert.deepEqual(preview.worktreeOffset, { x: 130, y: -70 });
    assert.deepEqual(preview.positions.get("terminal-1"), { x: 230, y: 130 });
    assert.deepEqual(preview.positions.get("terminal-2"), { x: 690, y: 170 });
    assert.equal(preview.positions.has("terminal-stashed"), false);
    assert.equal(preview.positions.has("terminal-3"), false);

    commitWorktreeGroupMove("project-1", "worktree-1", preview);

    const [mainWorktree, featureWorktree] =
      useProjectStore.getState().projects[0].worktrees;
    const terminal1 = mainWorktree.terminals.find(
      (terminal) => terminal.id === "terminal-1",
    );
    const terminal2 = mainWorktree.terminals.find(
      (terminal) => terminal.id === "terminal-2",
    );
    const terminal3 = featureWorktree.terminals.find(
      (terminal) => terminal.id === "terminal-3",
    );
    const stashed = mainWorktree.terminals.find(
      (terminal) => terminal.id === "terminal-stashed",
    );

    assert.ok(terminal1 && terminal2 && terminal3 && stashed);
    assert.equal(terminal1.x, 230);
    assert.equal(terminal1.y, 130);
    assert.equal(terminal2.x, 690);
    assert.equal(terminal2.y, 170);
    assert.equal(terminal2.x - terminal1.x, 460);
    assert.equal(terminal2.y - terminal1.y, 40);
    assert.equal(terminal3.x, 1600);
    assert.equal(terminal3.y, 400);
    assert.equal(stashed.x, 900);
    assert.equal(stashed.y, 900);
  } finally {
    useProjectStore.setState(previousState);
  }
});

test("commitWorktreeGroupMove keeps rigid preview positions even when they overlap unrelated terminals", async () => {
  installActionGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const {
    buildWorktreeGroupMove,
    commitWorktreeGroupMove,
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
          worktrees: [
            {
              id: "worktree-1",
              name: "main",
              path: "/tmp/project-1",
              terminals: [
                {
                  id: "drag-1",
                  title: "Drag 1",
                  type: "shell",
                  minimized: false,
                  focused: false,
                  ptyId: 1,
                  status: "running",
                  x: 100,
                  y: 100,
                  width: 400,
                  height: 300,
                  tags: [],
                },
              ],
            },
            {
              id: "worktree-2",
              name: "feature",
              path: "/tmp/project-1-feature",
              terminals: [
                {
                  id: "static-1",
                  title: "Static 1",
                  type: "shell",
                  minimized: false,
                  focused: false,
                  ptyId: 2,
                  status: "running",
                  x: 520,
                  y: 100,
                  width: 400,
                  height: 300,
                  tags: [],
                },
              ],
            },
          ],
        },
      ],
    });

    const preview = buildWorktreeGroupMove("project-1", "worktree-1", 420, 0);
    assert.ok(preview);
    assert.deepEqual(preview.positions.get("drag-1"), { x: 520, y: 100 });

    commitWorktreeGroupMove("project-1", "worktree-1", preview);

    const [mainWorktree, featureWorktree] =
      useProjectStore.getState().projects[0].worktrees;
    const dragged = mainWorktree.terminals.find((terminal) => terminal.id === "drag-1");
    const staticTerminal = featureWorktree.terminals.find(
      (terminal) => terminal.id === "static-1",
    );

    assert.ok(dragged && staticTerminal);
    assert.equal(dragged.x, 520);
    assert.equal(dragged.y, 100);
    assert.equal(staticTerminal.x, 520);
    assert.equal(staticTerminal.y, 100);
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
  const { closeTerminalInScene } = await import(
    "../src/actions/terminalSceneActions.ts"
  );
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
