import test from "node:test";
import assert from "node:assert/strict";

function installRuntimeGlobals() {
  const storage = new Map<string, string>();
  const navigator = {
    language: "en-US",
    userAgent: "node-test",
  };
  const target = new EventTarget();
  const mockWindow = Object.assign(target, {
    navigator,
  }) as Window;

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
}

test("reorderTerminal only reorders visible terminals and preserves stashed slots", async () => {
  installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
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
                  type: "claude",
                  minimized: false,
                  focused: false,
                  ptyId: null,
                  status: "idle",
                  stashed: true,
                  span: { cols: 2, rows: 1 },
                },
                {
                  id: "terminal-3",
                  title: "Terminal 3",
                  type: "codex",
                  minimized: false,
                  focused: false,
                  ptyId: null,
                  status: "idle",
                  span: { cols: 1, rows: 1 },
                },
                {
                  id: "terminal-4",
                  title: "Terminal 4",
                  type: "shell",
                  minimized: false,
                  focused: false,
                  ptyId: null,
                  status: "idle",
                  stashed: true,
                  span: { cols: 1, rows: 2 },
                },
                {
                  id: "terminal-5",
                  title: "Terminal 5",
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
      ],
    });

    useProjectStore
      .getState()
      .reorderTerminal("project-1", "worktree-1", "terminal-5", 0);

    const terminals =
      useProjectStore.getState().projects[0].worktrees[0].terminals;

    assert.deepEqual(
      terminals.map((terminal) => terminal.id),
      ["terminal-5", "terminal-2", "terminal-1", "terminal-4", "terminal-3"],
    );
    assert.equal(terminals[1]?.stashed, true);
    assert.equal(terminals[3]?.stashed, true);
  } finally {
    useProjectStore.setState(previousState);
  }
});
