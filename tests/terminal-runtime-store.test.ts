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

function seedProjectState(
  useProjectStore: typeof import("../src/stores/projectStore.ts").useProjectStore,
  terminal = createTerminal(),
) {
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
            terminals: [terminal],
          },
        ],
      },
    ],
  });
}

function createFakeContainer() {
  const node = {
    children: [] as Array<ReturnType<typeof createFakeContainer>>,
    parentElement: null as ReturnType<typeof createFakeContainer> | null,
    addEventListener() {},
    removeEventListener() {},
    appendChild(child: ReturnType<typeof createFakeContainer>) {
      child.parentElement?.removeChild(child);
      this.children.push(child);
      child.parentElement = this;
      return child;
    },
    removeChild(child: ReturnType<typeof createFakeContainer>) {
      this.children = this.children.filter((entry) => entry !== child);
      if (child.parentElement === this) {
        child.parentElement = null;
      }
      return child;
    },
  };

  return node;
}

function createMockXterm() {
  const stats = {
    blurCalls: 0,
    disposeCalls: 0,
    fitCalls: 0,
    inputBindingDisposeCalls: 0,
    loadAddonCalls: 0,
    refreshCalls: 0,
    resizeBindingDisposeCalls: 0,
    selectionBindingDisposeCalls: 0,
    selectionPointerCleanupCalls: 0,
    selectionSubscriptions: 0,
  };

  const xterm = {
    cols: 80,
    rows: 24,
    options: {},
    blur() {
      stats.blurCalls += 1;
    },
    dispose() {
      stats.disposeCalls += 1;
    },
    focus() {},
    getSelection() {
      return "";
    },
    loadAddon() {
      stats.loadAddonCalls += 1;
    },
    onData() {
      return {
        dispose() {
          stats.inputBindingDisposeCalls += 1;
        },
      };
    },
    onResize() {
      return {
        dispose() {
          stats.resizeBindingDisposeCalls += 1;
        },
      };
    },
    onSelectionChange() {
      stats.selectionSubscriptions += 1;
      return {
        dispose() {
          stats.selectionBindingDisposeCalls += 1;
        },
      };
    },
    refresh() {
      stats.refreshCalls += 1;
    },
    scrollToBottom() {},
    write() {},
  };

  const fitAddon = {
    fit() {
      stats.fitCalls += 1;
    },
  };

  return { fitAddon, stats, xterm };
}

test("destroyTerminalRuntime clears live pty ids from runtime overlay state", async () => {
  const mockWindow = installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const {
    destroyAllTerminalRuntimes,
    destroyTerminalRuntime,
    ensureTerminalRuntime,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const previousState = useProjectStore.getState();

  destroyAllTerminalRuntimes();

  try {
    seedProjectState(useProjectStore);

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
      useTerminalRuntimeStateStore.getState().terminals["terminal-1"]?.ptyId,
      null,
    );
  } finally {
    destroyAllTerminalRuntimes();
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousState);
  }
});

test("projectStore runtime actions update overlay state without mutating the scene tree", async () => {
  installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const {
    resolveTerminalWithRuntimeState,
    useTerminalRuntimeStateStore,
  } = await import("../src/stores/terminalRuntimeStateStore.ts");
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
              terminals: [
                {
                  id: "terminal-1",
                  title: "Terminal",
                  type: "shell",
                  minimized: false,
                  focused: true,
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

    const store = useProjectStore.getState();
    store.updateTerminalPtyId("project-1", "worktree-1", "terminal-1", 42);
    store.updateTerminalStatus("project-1", "worktree-1", "terminal-1", "running");
    store.updateTerminalSessionId(
      "project-1",
      "worktree-1",
      "terminal-1",
      "session-live",
    );

    const rawTerminal =
      useProjectStore.getState().projects[0].worktrees[0].terminals[0];
    const liveTerminal = resolveTerminalWithRuntimeState(rawTerminal);

    assert.equal(rawTerminal.ptyId, null);
    assert.equal(rawTerminal.status, "idle");
    assert.equal(rawTerminal.sessionId, undefined);
    assert.equal(liveTerminal.ptyId, 42);
    assert.equal(liveTerminal.status, "running");
    assert.equal(liveTerminal.sessionId, "session-live");
    assert.deepEqual(
      useTerminalRuntimeStateStore.getState().terminals["terminal-1"],
      {
        ptyId: 42,
        status: "running",
        sessionId: "session-live",
      },
    );
  } finally {
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousState);
  }
});

test("parked runtimes keep the live xterm, dispose live bindings, reuse the host, and clear parked hosts on destroy", async () => {
  const mockWindow = installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { registerTerminal } = await import("../src/terminal/terminalRegistry.ts");
  const {
    attachTerminalContainer,
    destroyAllTerminalRuntimes,
    destroyTerminalRuntime,
    detachTerminalContainer,
    ensureTerminalRuntime,
    getTerminalRuntime,
    serializeAllTerminalRuntimeBuffers,
    setTerminalRuntimeMode,
    useTerminalRuntimeStore,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const previousState = useProjectStore.getState();
  const resizeCalls: Array<{ cols: number; ptyId: number; rows: number }> = [];

  destroyAllTerminalRuntimes();

  try {
    seedProjectState(useProjectStore);

    ensureTerminalRuntime({
      projectId: "project-1",
      terminal: useProjectStore.getState().projects[0].worktrees[0].terminals[0],
      worktreeId: "worktree-1",
      worktreePath: "/tmp/project-1",
    });

    mockWindow.termcanvas = {
      terminal: {
        destroy: async () => {},
        input() {},
        resize(ptyId: number, cols: number, rows: number) {
          resizeCalls.push({ cols, ptyId, rows });
        },
      },
    };

    const runtime = getTerminalRuntime("terminal-1");
    assert.ok(runtime);
    if (!runtime) {
      return;
    }

    const host = createFakeContainer();
    const liveContainer = createFakeContainer();
    const parkedContainer = createFakeContainer();
    const visibleContainer = createFakeContainer();
    const { fitAddon, stats, xterm } = createMockXterm();
    const serializeAddon = {
      serialize() {
        return "live buffer";
      },
    };

    liveContainer.appendChild(host);
    runtime.attachedContainer = liveContainer as unknown as HTMLDivElement;
    runtime.fitAddon = fitAddon as unknown as typeof runtime.fitAddon;
    runtime.hostElement = host as unknown as HTMLDivElement;
    runtime.inputDisposable = {
      dispose() {
        stats.inputBindingDisposeCalls += 1;
      },
    };
    runtime.previewAnsi = "preview fallback";
    runtime.resizeDisposable = {
      dispose() {
        stats.resizeBindingDisposeCalls += 1;
      },
    };
    runtime.selectionDisposable = {
      dispose() {
        stats.selectionBindingDisposeCalls += 1;
      },
    } as typeof runtime.selectionDisposable;
    runtime.selectionPointerCleanup = () => {
      stats.selectionPointerCleanupCalls += 1;
    };
    runtime.serializeAddon = serializeAddon as typeof runtime.serializeAddon;
    runtime.xterm = xterm as unknown as typeof runtime.xterm;

    registerTerminal(
      "terminal-1",
      runtime.xterm as NonNullable<typeof runtime.xterm>,
      serializeAddon as NonNullable<typeof runtime.serializeAddon>,
    );

    setTerminalRuntimeMode("terminal-1", "parked");

    assert.equal(useTerminalRuntimeStore.getState().terminals["terminal-1"]?.mode, "parked");
    assert.equal(runtime.xterm, xterm);
    assert.equal(stats.blurCalls, 1);
    assert.equal(stats.disposeCalls, 0);
    assert.equal(stats.inputBindingDisposeCalls, 1);
    assert.equal(stats.resizeBindingDisposeCalls, 1);
    assert.equal(stats.selectionBindingDisposeCalls, 1);
    assert.equal(stats.selectionPointerCleanupCalls, 1);
    assert.equal(runtime.selectionDisposable, null);
    assert.equal(runtime.selectionPointerCleanup, null);
    assert.equal(host.parentElement, null);
    assert.equal(serializeAllTerminalRuntimeBuffers()["terminal-1"], "live buffer");

    setTerminalRuntimeMode("terminal-1", "live");
    attachTerminalContainer("terminal-1", visibleContainer as unknown as HTMLDivElement);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(runtime.xterm, xterm);
    assert.equal(host.parentElement, visibleContainer);
    assert.equal(stats.disposeCalls, 0);
    assert.equal(stats.selectionSubscriptions, 1);
    assert.ok(runtime.selectionDisposable);
    assert.equal(typeof runtime.selectionPointerCleanup, "function");
    assert.equal(stats.fitCalls >= 1, true);
    assert.deepEqual(resizeCalls.at(-1), {
      cols: 80,
      ptyId: 42,
      rows: 24,
    });

    detachTerminalContainer("terminal-1");
    assert.equal(host.parentElement, null);

    parkedContainer.appendChild(host);
    destroyTerminalRuntime("terminal-1");

    assert.equal(stats.disposeCalls, 1);
    assert.equal(host.parentElement, null);
    assert.equal(runtime.hostElement, null);
  } finally {
    destroyAllTerminalRuntimes();
    useProjectStore.setState(previousState);
  }
});

test("parked runtimes apply font preference updates without fitting against the parking host", async () => {
  const mockWindow = installRuntimeGlobals();
  const { buildFontFamily } = await import("../src/terminal/fontRegistry.ts");
  const { usePreferencesStore } = await import("../src/stores/preferencesStore.ts");
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const {
    destroyAllTerminalRuntimes,
    ensureTerminalRuntime,
    getTerminalRuntime,
    setTerminalRuntimeMode,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const previousProjectState = useProjectStore.getState();
  const previousPreferencesState = usePreferencesStore.getState();

  destroyAllTerminalRuntimes();

  try {
    seedProjectState(useProjectStore);
    mockWindow.termcanvas = {
      terminal: {
        create: async () => 42,
        destroy: async () => {},
        input() {},
        onExit() {
          return () => {};
        },
        onOutput() {
          return () => {};
        },
        resize() {},
      },
      session: {
        onTurnComplete() {
          return () => {};
        },
      },
    };

    ensureTerminalRuntime({
      projectId: "project-1",
      terminal: useProjectStore.getState().projects[0].worktrees[0].terminals[0],
      worktreeId: "worktree-1",
      worktreePath: "/tmp/project-1",
    });

    const runtime = getTerminalRuntime("terminal-1");
    assert.ok(runtime);
    if (!runtime) {
      return;
    }

    const { fitAddon, stats, xterm } = createMockXterm();
    runtime.fitAddon = fitAddon as unknown as typeof runtime.fitAddon;
    runtime.xterm = xterm as unknown as typeof runtime.xterm;

    setTerminalRuntimeMode("terminal-1", "parked");
    usePreferencesStore.getState().setTerminalFontSize(18);
    usePreferencesStore.getState().setTerminalFontFamily("jetbrains-mono");

    assert.equal(runtime.mode, "parked");
    assert.equal(stats.fitCalls, 0);
    assert.equal(runtime.xterm?.options.fontSize, 18);
    assert.equal(runtime.xterm?.options.fontFamily, buildFontFamily("jetbrains-mono"));
  } finally {
    destroyAllTerminalRuntimes();
    useProjectStore.setState(previousProjectState);
    usePreferencesStore.setState(previousPreferencesState);
  }
});

test("starting a parked runtime does not fit or resize the hidden terminal host", async () => {
  const mockWindow = installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const {
    destroyAllTerminalRuntimes,
    ensureTerminalRuntime,
    getTerminalRuntime,
    setTerminalRuntimeMode,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const previousProjectState = useProjectStore.getState();
  const resizeCalls: Array<{ cols: number; ptyId: number; rows: number }> = [];
  let createCalls = 0;

  destroyAllTerminalRuntimes();

  try {
    const terminal = {
      ...createTerminal(),
      ptyId: null,
    };
    seedProjectState(useProjectStore, terminal);

    ensureTerminalRuntime({
      projectId: "project-1",
      terminal,
      worktreeId: "worktree-1",
      worktreePath: "/tmp/project-1",
    });

    const runtime = getTerminalRuntime("terminal-1");
    assert.ok(runtime);
    if (!runtime) {
      return;
    }

    const host = createFakeContainer();
    const liveContainer = createFakeContainer();
    const { fitAddon, stats, xterm } = createMockXterm();
    liveContainer.appendChild(host);
    runtime.attachedContainer = liveContainer as unknown as HTMLDivElement;
    runtime.fitAddon = fitAddon as unknown as typeof runtime.fitAddon;
    runtime.hostElement = host as unknown as HTMLDivElement;
    runtime.serializeAddon = {
      serialize() {
        return "live buffer";
      },
    } as typeof runtime.serializeAddon;
    runtime.xterm = xterm as unknown as typeof runtime.xterm;

    setTerminalRuntimeMode("terminal-1", "live");
    setTerminalRuntimeMode("terminal-1", "parked");

    mockWindow.termcanvas = {
      session: {
        onTurnComplete() {
          return () => {};
        },
      },
      terminal: {
        create: async () => {
          createCalls += 1;
          return 100 + createCalls;
        },
        destroy: async () => {},
        input() {},
        onExit() {
          return () => {};
        },
        onOutput() {
          return () => {};
        },
        resize(ptyId: number, cols: number, rows: number) {
          resizeCalls.push({ cols, ptyId, rows });
        },
      },
    };

    ensureTerminalRuntime({
      projectId: "project-1",
      terminal,
      worktreeId: "worktree-1",
      worktreePath: "/tmp/project-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(runtime.mode, "parked");
    assert.equal(runtime.attachedContainer, null);
    assert.equal(runtime.ptyId, 101);
    assert.equal(stats.fitCalls, 0);
    assert.deepEqual(resizeCalls, []);
    assert.equal(runtime.inputDisposable, null);
    assert.equal(runtime.resizeDisposable, null);
  } finally {
    destroyAllTerminalRuntimes();
    useProjectStore.setState(previousProjectState);
  }
});

test("reattaching a parked runtime reacquires WebGL after the pool evicts it", async () => {
  const mockWindow = installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { acquireWebGL, releaseWebGL } = await import("../src/terminal/webglContextPool.ts");
  const {
    attachTerminalContainer,
    destroyAllTerminalRuntimes,
    destroyTerminalRuntime,
    ensureTerminalRuntime,
    getTerminalRuntime,
    setTerminalRuntimeMode,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const previousState = useProjectStore.getState();

  destroyAllTerminalRuntimes();

  try {
    seedProjectState(useProjectStore);

    ensureTerminalRuntime({
      projectId: "project-1",
      terminal: useProjectStore.getState().projects[0].worktrees[0].terminals[0],
      worktreeId: "worktree-1",
      worktreePath: "/tmp/project-1",
    });

    mockWindow.termcanvas = {
      terminal: {
        destroy: async () => {},
        input() {},
        resize() {},
      },
    };

    const runtime = getTerminalRuntime("terminal-1");
    assert.ok(runtime);
    if (!runtime) {
      return;
    }

    const host = createFakeContainer();
    const liveContainer = createFakeContainer();
    const visibleContainer = createFakeContainer();
    const { fitAddon, stats, xterm } = createMockXterm();
    const serializeAddon = {
      serialize() {
        return "live buffer";
      },
    };

    liveContainer.appendChild(host);
    runtime.attachedContainer = liveContainer as unknown as HTMLDivElement;
    runtime.fitAddon = fitAddon as unknown as typeof runtime.fitAddon;
    runtime.hostElement = host as unknown as HTMLDivElement;
    runtime.serializeAddon = serializeAddon as typeof runtime.serializeAddon;
    runtime.xterm = xterm as unknown as typeof runtime.xterm;

    assert.equal(
      acquireWebGL(
        "terminal-1",
        runtime.xterm as NonNullable<typeof runtime.xterm>,
      ),
      true,
    );
    assert.equal(stats.loadAddonCalls, 1);

    setTerminalRuntimeMode("terminal-1", "parked");
    releaseWebGL("terminal-1");
    setTerminalRuntimeMode("terminal-1", "live");
    attachTerminalContainer("terminal-1", visibleContainer as unknown as HTMLDivElement);

    assert.equal(host.parentElement, visibleContainer);
    assert.equal(stats.loadAddonCalls, 2);

    destroyTerminalRuntime("terminal-1");
  } finally {
    destroyAllTerminalRuntimes();
    useProjectStore.setState(previousState);
    releaseWebGL("terminal-1");
  }
});

test("codex SessionStart hook cancels fallback polling and preserves the exact session", async () => {
  const mockWindow = installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const {
    destroyAllTerminalRuntimes,
    ensureTerminalRuntime,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const previousProjectState = useProjectStore.getState();
  let sessionStartListener: ((
    payload: {
      terminalId: string;
      sessionId: string;
      transcriptPath: string | null;
      cwd: string | null;
    },
  ) => void) | null = null;
  let findCodexCalls = 0;
  const watchCalls: Array<{
    cwd: string;
    sessionId: string;
    type: string;
  }> = [];
  const attachCalls: Array<{
    confidence: string;
    cwd: string;
    provider: string;
    sessionId: string;
    terminalId: string;
  }> = [];

  destroyAllTerminalRuntimes();

  try {
    seedProjectState(useProjectStore, {
      ...createTerminal(),
      ptyId: null,
      status: "idle",
      title: "codex",
      type: "codex",
    });

    mockWindow.termcanvas = {
      hooks: {
        getHealth: async () => ({
          eventsReceived: 0,
          lastEventAt: null,
          parseErrors: 0,
          socketPath: null,
        }),
        getSocketPath: async () => null,
        onSessionStarted(
          callback: (payload: {
            terminalId: string;
            sessionId: string;
            transcriptPath: string | null;
            cwd: string | null;
          }) => void,
        ) {
          sessionStartListener = callback;
          return () => {
            if (sessionStartListener === callback) {
              sessionStartListener = null;
            }
          };
        },
        onStopFailure() {
          return () => {};
        },
        onTurnComplete() {
          return () => {};
        },
      },
      session: {
        findCodex: async () => {
          findCodexCalls += 1;
          return { confidence: "medium", sessionId: "wrong-session" };
        },
        getBypassState: async () => false,
        getCodexLatest: async () => "baseline-session",
        onTurnComplete() {
          return () => {};
        },
        unwatch: async () => {},
        watch: async (type: string, sessionId: string, cwd: string) => {
          watchCalls.push({ cwd, sessionId, type });
          return { ok: true };
        },
      },
      telemetry: {
        attachSession: async (input: {
          confidence: string;
          cwd: string;
          provider: string;
          sessionId: string;
          terminalId: string;
        }) => {
          attachCalls.push(input);
          return { ok: true, sessionFile: `/tmp/${input.sessionId}.jsonl` };
        },
        detachSession: async () => {},
        getTerminal: async () => null,
        onSnapshotChanged() {
          return () => {};
        },
      },
      terminal: {
        create: async () => 42,
        destroy: async () => {},
        input() {},
        notifyThemeChanged() {},
        onExit() {
          return () => {};
        },
        onOutput() {
          return () => {};
        },
        resize() {},
      },
    };

    ensureTerminalRuntime({
      projectId: "project-1",
      terminal: useProjectStore.getState().projects[0].worktrees[0].terminals[0],
      worktreeId: "worktree-1",
      worktreePath: "/tmp/project-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(
      sessionStartListener,
      "codex runtime should register a SessionStart hook listener",
    );

    sessionStartListener?.({
      cwd: "/tmp/project-1",
      sessionId: "correct-session",
      terminalId: "terminal-1",
      transcriptPath: "/tmp/correct-session.jsonl",
    });

    await new Promise((resolve) => setTimeout(resolve, 650));

    assert.equal(findCodexCalls, 0);
    assert.deepEqual(watchCalls, [
      {
        cwd: "/tmp/project-1",
        sessionId: "correct-session",
        type: "codex",
      },
    ]);
    assert.deepEqual(attachCalls, [
      {
        confidence: "strong",
        cwd: "/tmp/project-1",
        provider: "codex",
        sessionId: "correct-session",
        terminalId: "terminal-1",
      },
    ]);
    assert.equal(
      useTerminalRuntimeStateStore.getState().terminals["terminal-1"]?.sessionId,
      "correct-session",
    );
  } finally {
    destroyAllTerminalRuntimes();
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousProjectState);
  }
});

test("wuu polling attaches the discovered session to telemetry", async () => {
  const mockWindow = installRuntimeGlobals();
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const {
    destroyAllTerminalRuntimes,
    ensureTerminalRuntime,
  } = await import("../src/terminal/terminalRuntimeStore.ts");
  const previousProjectState = useProjectStore.getState();
  const watchCalls: Array<{
    cwd: string;
    sessionId: string;
    type: string;
  }> = [];
  const attachCalls: Array<{
    confidence: string;
    cwd: string;
    provider: string;
    sessionId: string;
    terminalId: string;
  }> = [];
  let findWuuCalls = 0;

  destroyAllTerminalRuntimes();

  try {
    seedProjectState(useProjectStore, {
      ...createTerminal(),
      ptyId: null,
      status: "idle",
      title: "wuu",
      type: "wuu",
    });

    mockWindow.termcanvas = {
      session: {
        findWuu: async () => {
          findWuuCalls += 1;
          return {
            confidence: "medium",
            filePath: "/tmp/project-1/.wuu/sessions/wuu-session.jsonl",
            sessionId: "wuu-session",
          };
        },
        onTurnComplete() {
          return () => {};
        },
        unwatch: async () => {},
        watch: async (type: string, sessionId: string, cwd: string) => {
          watchCalls.push({ cwd, sessionId, type });
          return { ok: true };
        },
      },
      telemetry: {
        attachSession: async (input: {
          confidence: string;
          cwd: string;
          provider: string;
          sessionId: string;
          terminalId: string;
        }) => {
          attachCalls.push(input);
          return { ok: true, sessionFile: `/tmp/${input.sessionId}.jsonl` };
        },
        detachSession: async () => {},
        getTerminal: async () => null,
        onSnapshotChanged() {
          return () => {};
        },
      },
      terminal: {
        create: async () => 42,
        destroy: async () => {},
        input() {},
        notifyThemeChanged() {},
        onExit() {
          return () => {};
        },
        onOutput() {
          return () => {};
        },
        resize() {},
      },
    };

    ensureTerminalRuntime({
      projectId: "project-1",
      terminal: useProjectStore.getState().projects[0].worktrees[0].terminals[0],
      worktreeId: "worktree-1",
      worktreePath: "/tmp/project-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    assert.ok(findWuuCalls > 0);
    assert.deepEqual(watchCalls, [
      {
        cwd: "/tmp/project-1",
        sessionId: "wuu-session",
        type: "wuu",
      },
    ]);
    assert.deepEqual(attachCalls, [
      {
        confidence: "medium",
        cwd: "/tmp/project-1",
        provider: "wuu",
        sessionId: "wuu-session",
        terminalId: "terminal-1",
      },
    ]);
    assert.equal(
      useTerminalRuntimeStateStore.getState().terminals["terminal-1"]?.sessionId,
      "wuu-session",
    );
  } finally {
    destroyAllTerminalRuntimes();
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousProjectState);
  }
});
