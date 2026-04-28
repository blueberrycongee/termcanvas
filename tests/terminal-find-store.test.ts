import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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
}

function installDestroyApi() {
  (window as unknown as { termcanvas: unknown }).termcanvas = {
    app: { platform: "darwin" },
    terminal: {
      destroy: async () => {},
    },
  };
}

function createTerminal() {
  return {
    id: "terminal-1",
    title: "Terminal",
    type: "shell" as const,
    minimized: false,
    focused: true,
    ptyId: 42,
    status: "running" as const,
    span: { cols: 1, rows: 1 },
  };
}

async function createRuntime() {
  installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const {
    destroyAllTerminalRuntimes,
    ensureTerminalRuntime,
    getTerminalRuntime,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const { useTerminalFindStore } = await import(
    "../src/stores/terminalFindStore.ts"
  );
  const previousProjectState = useProjectStore.getState();

  destroyAllTerminalRuntimes();
  useTerminalFindStore.getState().close();
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
            terminals: [createTerminal()],
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

  const runtime = getTerminalRuntime("terminal-1");
  assert.ok(runtime);
  return {
    destroyAllTerminalRuntimes,
    previousProjectState,
    runtime,
    useProjectStore,
    useTerminalFindStore,
  };
}

function createSearchHarness(selectionRef: { value: string }) {
  const calls: string[] = [];
  let listener:
    | ((event: { resultIndex: number; resultCount: number }) => void)
    | null = null;

  return {
    calls,
    searchAddon: {
      clearDecorations() {
        listener?.({ resultIndex: -1, resultCount: 0 });
      },
      findNext(query: string) {
        calls.push(query);
        selectionRef.value = query;
        listener?.({ resultIndex: 0, resultCount: 2 });
        return true;
      },
      findPrevious(query: string) {
        calls.push(`previous:${query}`);
        selectionRef.value = query;
        listener?.({ resultIndex: 1, resultCount: 2 });
        return true;
      },
      onDidChangeResults(
        next: (event: { resultIndex: number; resultCount: number }) => void,
      ) {
        listener = next;
        return {
          dispose() {
            if (listener === next) listener = null;
          },
        };
      },
    },
  };
}

test("terminal find adopts a new same-terminal selection while already open", async () => {
  const {
    destroyAllTerminalRuntimes,
    previousProjectState,
    runtime,
    useProjectStore,
    useTerminalFindStore,
  } = await createRuntime();
  const selectionRef = { value: "" };
  const { calls, searchAddon } = createSearchHarness(selectionRef);

  try {
    runtime.xterm = {
      blur() {},
      dispose() {},
      getSelection() {
        return selectionRef.value;
      },
    } as typeof runtime.xterm;
    runtime.searchAddon = searchAddon as typeof runtime.searchAddon;

    useTerminalFindStore.getState().openFor("terminal-1", "needle");
    assert.equal(useTerminalFindStore.getState().query, "needle");
    assert.equal(useTerminalFindStore.getState().resultCount, 2);

    selectionRef.value = "other";
    useTerminalFindStore.getState().openFor("terminal-1", "other");

    assert.equal(useTerminalFindStore.getState().query, "other");
    assert.deepEqual(calls, ["needle", "other"]);
  } finally {
    useTerminalFindStore.getState().close();
    installDestroyApi();
    destroyAllTerminalRuntimes();
    useProjectStore.setState(previousProjectState);
  }
});

test("terminal find binds result events when the search addon appears after open", async () => {
  const {
    destroyAllTerminalRuntimes,
    previousProjectState,
    runtime,
    useProjectStore,
    useTerminalFindStore,
  } = await createRuntime();
  const selectionRef = { value: "" };
  const { searchAddon } = createSearchHarness(selectionRef);

  try {
    runtime.xterm = {
      blur() {},
      dispose() {},
      getSelection() {
        return selectionRef.value;
      },
    } as typeof runtime.xterm;
    runtime.searchAddon = null;

    useTerminalFindStore.getState().openFor("terminal-1");
    assert.equal(useTerminalFindStore.getState().resultCount, 0);

    runtime.searchAddon = searchAddon as typeof runtime.searchAddon;
    useTerminalFindStore.getState().setQuery("needle");

    assert.equal(useTerminalFindStore.getState().query, "needle");
    assert.equal(useTerminalFindStore.getState().resultIndex, 0);
    assert.equal(useTerminalFindStore.getState().resultCount, 2);
  } finally {
    useTerminalFindStore.getState().close();
    installDestroyApi();
    destroyAllTerminalRuntimes();
    useProjectStore.setState(previousProjectState);
  }
});

test("terminal runtime enables xterm proposed APIs required by search decorations", () => {
  const source = fs.readFileSync("src/terminal/terminalRuntimeStore.ts", "utf-8");

  assert.match(source, /allowProposedApi:\s*true/);
  assert.match(source, /new SearchAddon\(\)/);
});
