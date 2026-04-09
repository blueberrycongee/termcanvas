import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalData } from "../src/types/index.ts";

interface SummaryResult {
  ok: boolean;
  summary?: string;
  error?: string;
  sessionFileSize?: number;
}

interface TimeoutHarness {
  pendingCount: () => number;
  triggerAll: () => void;
  restore: () => void;
}

function installGlobals(generateSummary: () => Promise<SummaryResult>) {
  const storage = new Map<string, string>();
  const navigator = {
    language: "en-US",
    userAgent: "node-test",
    clipboard: {
      writeText: async () => {},
    },
  };

  const termcanvas = {
    app: {
      platform: "darwin" as const,
    },
    summary: {
      generate: generateSummary,
    },
  };

  const target = new EventTarget();
  const mockWindow = Object.assign(target, {
    navigator,
    termcanvas,
  }) as Window & { termcanvas: typeof termcanvas };

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

function installTimeoutHarness(): TimeoutHarness {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  let nextId = 1;
  const callbacks = new Map<number, () => void>();

  globalThis.setTimeout = ((handler: any, _timeout?: number, ...args: unknown[]) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, () => {
      if (typeof handler === "function") {
        handler(...args);
      }
    });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    callbacks.delete(Number(handle));
  }) as typeof clearTimeout;

  return {
    pendingCount: () => callbacks.size,
    triggerAll: () => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) {
        callback();
      }
    },
    restore: () => {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

function seedProjectState(
  useProjectStore: typeof import("../src/stores/projectStore.ts").useProjectStore,
  terminal: TerminalData,
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

function createTerminal(overrides: Partial<TerminalData> = {}): TerminalData {
  return {
    id: "terminal-1",
    title: "Claude",
    type: "claude",
    minimized: false,
    focused: false,
    ptyId: 11,
    status: "idle",
    span: { cols: 1, rows: 1 },
    sessionId: "session-1",
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function importSummaryScheduler(tag: string) {
  return import(`../src/terminal/summaryScheduler.ts?${tag}`);
}

test("onTerminalTurnCompleted skips scheduling when summary is disabled", async () => {
  let generateCalls = 0;
  installGlobals(async () => {
    generateCalls += 1;
    return { ok: true, summary: "should-not-run", sessionFileSize: 1 };
  });
  const timer = installTimeoutHarness();

  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { usePreferencesStore } = await import("../src/stores/preferencesStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const previousProjectState = useProjectStore.getState();
  const previousPreferenceState = usePreferencesStore.getState();

  try {
    seedProjectState(useProjectStore, createTerminal());
    usePreferencesStore.setState({ summaryEnabled: false, summaryCli: "claude" });

    const { onTerminalTurnCompleted } = await importSummaryScheduler("disabled-before-schedule");
    onTerminalTurnCompleted("terminal-1");

    assert.equal(timer.pendingCount(), 0);
    timer.triggerAll();
    await flushMicrotasks();
    assert.equal(generateCalls, 0);
  } finally {
    timer.restore();
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousProjectState);
    usePreferencesStore.setState(previousPreferenceState);
  }
});

test("onTerminalTurnCompleted skips request when disabled after debounce scheduling", async () => {
  let generateCalls = 0;
  installGlobals(async () => {
    generateCalls += 1;
    return { ok: true, summary: "should-not-run", sessionFileSize: 1 };
  });
  const timer = installTimeoutHarness();

  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { usePreferencesStore } = await import("../src/stores/preferencesStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const previousProjectState = useProjectStore.getState();
  const previousPreferenceState = usePreferencesStore.getState();

  try {
    seedProjectState(useProjectStore, createTerminal());
    usePreferencesStore.setState({ summaryEnabled: true, summaryCli: "claude" });

    const { onTerminalTurnCompleted } = await importSummaryScheduler("disabled-after-schedule");
    onTerminalTurnCompleted("terminal-1");
    assert.equal(timer.pendingCount(), 1);

    usePreferencesStore.setState({ summaryEnabled: false });
    timer.triggerAll();
    await flushMicrotasks();

    assert.equal(generateCalls, 0);
  } finally {
    timer.restore();
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousProjectState);
    usePreferencesStore.setState(previousPreferenceState);
  }
});

test("requestSummary ignores stale async result after session switch", async () => {
  const deferred = createDeferred<SummaryResult>();
  installGlobals(async () => deferred.promise);

  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { usePreferencesStore } = await import("../src/stores/preferencesStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const previousProjectState = useProjectStore.getState();
  const previousPreferenceState = usePreferencesStore.getState();

  try {
    seedProjectState(useProjectStore, createTerminal());
    usePreferencesStore.setState({ summaryEnabled: true, summaryCli: "claude" });

    const { requestSummary } = await importSummaryScheduler("stale-result-guard");
    const terminal = useProjectStore.getState().projects[0].worktrees[0].terminals[0];

    requestSummary("project-1", "worktree-1", "/tmp/project-1", terminal, "claude");
    useTerminalRuntimeStateStore.getState().setSessionId("terminal-1", "session-2");

    deferred.resolve({
      ok: true,
      summary: "summary-from-old-session",
      sessionFileSize: 10,
    });
    await flushMicrotasks();

    const latest = useProjectStore.getState().projects[0].worktrees[0].terminals[0];
    assert.equal(latest.customTitle, undefined);
  } finally {
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousProjectState);
    usePreferencesStore.setState(previousPreferenceState);
  }
});

test("requestSummary still updates title when session stays unchanged", async () => {
  installGlobals(async () => ({
    ok: true,
    summary: "expected-summary",
    sessionFileSize: 20,
  }));

  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { usePreferencesStore } = await import("../src/stores/preferencesStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const previousProjectState = useProjectStore.getState();
  const previousPreferenceState = usePreferencesStore.getState();

  try {
    seedProjectState(useProjectStore, createTerminal());
    usePreferencesStore.setState({ summaryEnabled: true, summaryCli: "claude" });

    const { requestSummary } = await importSummaryScheduler("success-path");
    const terminal = useProjectStore.getState().projects[0].worktrees[0].terminals[0];

    requestSummary("project-1", "worktree-1", "/tmp/project-1", terminal, "claude");
    await flushMicrotasks();

    const latest = useProjectStore.getState().projects[0].worktrees[0].terminals[0];
    assert.equal(latest.customTitle, "expected-summary");
  } finally {
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousProjectState);
    usePreferencesStore.setState(previousPreferenceState);
  }
});
