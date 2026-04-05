import test from "node:test";
import assert from "node:assert/strict";

function installBrowserGlobals() {
  const storage = new Map<string, string>();
  const navigator = {
    language: "en-US",
    userAgent: "node-test",
  };

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
    value: {
      addEventListener() {},
      innerHeight: 900,
      innerWidth: 1440,
      navigator,
      termcanvas: undefined,
    },
  });
}

async function loadSnapshotState(tag: string) {
  installBrowserGlobals();
  return import(`../src/snapshotBridge.ts?${tag}`);
}

async function loadSnapshotRuntimeState(tag: string) {
  installBrowserGlobals();
  return import(`../src/snapshotState.ts?${tag}`);
}

test("readWorkspaceSnapshot migrates a legacy v1 snapshot into legacy + scene shapes", async () => {
  const { readWorkspaceSnapshot } = await loadSnapshotState("legacy-v1");

  const restored = readWorkspaceSnapshot({
    version: 1,
    viewport: { x: 12, y: 24, scale: 0.75 },
    projects: [
      {
        id: "project-1",
        name: "Project One",
        path: "/tmp/project-1",
        position: { x: 100, y: 200 },
        worktrees: [
          {
            id: "worktree-1",
            name: "main",
            path: "/tmp/project-1",
            terminals: [
              {
                id: "terminal-1",
                title: "Terminal",
                type: "shell",
              },
            ],
          },
        ],
      },
    ],
    drawings: [{ id: "drawing-1", type: "rect" }],
    browserCards: {
      "card-1": {
        id: "card-1",
      },
    },
  });

  assert.ok(restored);
  assert.equal(restored && "legacy" in restored, true);
  if (!restored || !("legacy" in restored)) {
    return;
  }

  assert.equal(restored.sourceVersion, 1);
  assert.deepEqual(restored.legacy.viewport, { x: 12, y: 24, scale: 0.75 });
  assert.equal(restored.legacy.projects[0].worktrees[0].terminals[0].ptyId, null);
  assert.equal(restored.scene.camera.zoom, 0.75);
  assert.equal(restored.scene.projects[0].id, "project-1");
  assert.equal(restored.scene.annotations[0]?.id, "drawing-1");
});

test("readWorkspaceSnapshot understands the future scene-first shape without requiring the new renderer", async () => {
  const { readWorkspaceSnapshot } = await loadSnapshotState("scene-v2");

  const restored = readWorkspaceSnapshot({
    version: 2,
    scene: {
      version: 2,
      camera: { x: 40, y: 60, zoom: 1.25 },
      projects: [
        {
          id: "project-2",
          name: "Project Two",
          path: "/tmp/project-2",
          position: { x: 0, y: 0 },
          collapsed: false,
          zIndex: 1,
          worktrees: [],
        },
      ],
      annotations: [
        {
          id: "drawing-2",
          type: "arrow",
          anchor: {
            kind: "world",
            position: { x: 10, y: 20 },
          },
          color: "#fff",
          strokeWidth: 2,
          end: { x: 50, y: 60 },
        },
      ],
      browserCards: {
        "card-2": {
          id: "card-2",
        },
      },
    },
  });

  assert.ok(restored);
  assert.equal(restored && "legacy" in restored, true);
  if (!restored || !("legacy" in restored)) {
    return;
  }

  assert.equal(restored.sourceVersion, 2);
  assert.deepEqual(restored.legacy.viewport, {
    x: 40,
    y: 60,
    scale: 1.25,
  });
  assert.equal(restored.scene.camera.zoom, 1.25);
  assert.equal(restored.legacy.projects[0].id, "project-2");
  assert.equal(restored.legacy.drawings[0]?.id, "drawing-2");
});

test("readWorkspaceSnapshot preserves entity-anchored annotations across legacy bridge round-trips", async () => {
  installBrowserGlobals();
  const {
    buildSceneDocumentFromLegacyState,
    sceneDocumentToLegacyState,
  } = await import("../src/canvas/sceneProjection.ts?entity-anchor");

  const scene = {
    version: 2 as const,
    camera: { x: 0, y: 0, zoom: 1 },
    projects: [],
    browserCards: {},
    annotations: [
      {
        id: "annotation-1",
        type: "text" as const,
        anchor: {
          kind: "entity" as const,
          entityId: "terminal-1",
          offset: { x: 12, y: 24 },
        },
        color: "#fff",
        fontSize: 14,
        content: "hello",
      },
    ],
  };

  const legacy = sceneDocumentToLegacyState(scene);
  assert.deepEqual(legacy.drawings[0]?.anchor, scene.annotations[0].anchor);

  const rebuilt = buildSceneDocumentFromLegacyState(legacy);
  assert.deepEqual(rebuilt.annotations[0]?.anchor, scene.annotations[0].anchor);
});

test("readWorkspaceSnapshot skips invalid scene annotations instead of crashing", async () => {
  const { readWorkspaceSnapshot } = await loadSnapshotState("scene-invalid-annotations");

  const restored = readWorkspaceSnapshot({
    version: 2,
    scene: {
      version: 2,
      camera: { x: 0, y: 0, zoom: 1 },
      projects: [],
      browserCards: {},
      annotations: [
        null,
        {
          id: "annotation-1",
          type: "rect",
          anchor: {
            kind: "world",
            position: { x: 10, y: 20 },
          },
          color: "#fff",
          strokeWidth: 1,
          width: 100,
          height: 50,
        },
        {
          id: "broken",
          type: "text",
        },
      ],
    },
  });

  assert.ok(restored);
  assert.equal(restored && "legacy" in restored, true);
  if (!restored || !("legacy" in restored)) {
    return;
  }

  assert.equal(restored.scene.annotations.length, 1);
  assert.equal(restored.scene.annotations[0]?.id, "annotation-1");
});

test("readWorkspaceSnapshot rejects unrelated JSON instead of treating it as an empty workspace", async () => {
  const { readWorkspaceSnapshot } = await loadSnapshotState("invalid-json");

  assert.equal(
    readWorkspaceSnapshot({
      foo: "bar",
      items: [1, 2, 3],
    }),
    null,
  );
});

test("scene restores keep terminal status while sanitizing runtime-only PTY ids", async () => {
  const { readWorkspaceSnapshot } = await loadSnapshotState("scene-status");

  const restored = readWorkspaceSnapshot({
    version: 2,
    scene: {
      version: 2,
      camera: { x: 0, y: 0, zoom: 1 },
      browserCards: {},
      annotations: [],
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
                  focused: false,
                  ptyId: 99,
                  status: "active",
                  span: { cols: 1, rows: 1 },
                },
              ],
            },
          ],
        },
      ],
    },
  });

  assert.ok(restored);
  assert.equal(restored && "legacy" in restored, true);
  if (!restored || !("legacy" in restored)) {
    return;
  }

  assert.equal(
    restored.scene.projects[0].worktrees[0].terminals[0].status,
    "active",
  );
  assert.equal(restored.scene.projects[0].worktrees[0].terminals[0].ptyId, null);
});

test("readWorkspaceSnapshot preserves the skip-restore sentinel", async () => {
  const { readWorkspaceSnapshot } = await loadSnapshotState("skip-restore");

  assert.deepEqual(readWorkspaceSnapshot({ skipRestore: true }), {
    skipRestore: true,
  });
});

test("restoreWorkspaceSnapshot clears existing terminal runtimes before applying restored state", async () => {
  const { restoreWorkspaceSnapshot } = await loadSnapshotRuntimeState("restore-runtime");
  const { ensureTerminalRuntime, useTerminalRuntimeStore } = await import(
    "../src/terminal/terminalRuntimeStore.ts"
  );
  const { useSelectionStore } = await import("../src/stores/selectionStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const { useBrowserCardStore } = await import("../src/stores/browserCardStore.ts");

  ensureTerminalRuntime({
    projectId: "project-live",
    terminal: {
      id: "terminal-1",
      title: "Terminal",
      type: "shell",
      minimized: false,
      focused: true,
      ptyId: null,
      status: "running",
      span: { cols: 1, rows: 1 },
    },
    worktreeId: "worktree-live",
    worktreePath: "/tmp/project-live",
  });

  assert.ok(useTerminalRuntimeStore.getState().terminals["terminal-1"]);
  useTerminalRuntimeStateStore.getState().setSessionId("terminal-1", "session-live");
  useSelectionStore.getState().setSelectedItems([
    {
      type: "terminal",
      projectId: "project-live",
      worktreeId: "worktree-live",
      terminalId: "terminal-1",
    },
  ]);

  restoreWorkspaceSnapshot({
    sourceVersion: 1,
    legacy: {
      version: 1,
      viewport: { x: 0, y: 0, scale: 1 },
      projects: [],
      drawings: [],
      browserCards: {},
    },
    scene: {
      version: 2,
      annotations: [],
      browserCards: {
        "card-1": {
          id: "card-1",
          title: "Example",
          url: "https://example.com",
          x: 10,
          y: 20,
          w: 320,
          h: 240,
        },
      },
      camera: { x: 0, y: 0, zoom: 1 },
      projects: [],
    },
  });

  assert.deepEqual(useTerminalRuntimeStore.getState().terminals, {});
  assert.deepEqual(useTerminalRuntimeStateStore.getState().terminals, {});
  assert.deepEqual(useSelectionStore.getState().selectedItems, []);
  assert.deepEqual(useBrowserCardStore.getState().cards, {
    "card-1": {
      id: "card-1",
      title: "Example",
      url: "https://example.com",
      x: 10,
      y: 20,
      w: 320,
      h: 240,
    },
  });
});

test("buildSnapshotState persists overlay session ids without leaking runtime-only terminal fields", async () => {
  const { buildSnapshotState } = await loadSnapshotRuntimeState("snapshot-overlay");
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useBrowserCardStore } = await import("../src/stores/browserCardStore.ts");
  const { useTerminalRuntimeStateStore } = await import(
    "../src/stores/terminalRuntimeStateStore.ts"
  );
  const previousState = useProjectStore.getState();
  const previousBrowserState = useBrowserCardStore.getState();

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
                  type: "claude",
                  minimized: false,
                  focused: true,
                  ptyId: 41,
                  status: "running",
                  span: { cols: 1, rows: 1 },
                  sessionId: "stale-session",
                },
              ],
            },
          ],
        },
      ],
    });
    useBrowserCardStore.setState({
      cards: {
        "card-live": {
          id: "card-live",
          title: "Live Card",
          url: "https://example.com/live",
          x: 40,
          y: 60,
          w: 500,
          h: 320,
        },
      },
    });
    useTerminalRuntimeStateStore
      .getState()
      .setSessionId("terminal-1", "live-session");
    useTerminalRuntimeStateStore.getState().setPtyId("terminal-1", 99);
    useTerminalRuntimeStateStore.getState().setStatus("terminal-1", "active");

    const snapshot = buildSnapshotState();
    const terminal = snapshot.scene.projects[0].worktrees[0].terminals[0];

    assert.equal(terminal.sessionId, "live-session");
    assert.equal("ptyId" in terminal, false);
    assert.equal("status" in terminal, false);
    assert.deepEqual(snapshot.scene.browserCards, {
      "card-live": {
        id: "card-live",
        title: "Live Card",
        url: "https://example.com/live",
        x: 40,
        y: 60,
        w: 500,
        h: 320,
      },
    });
  } finally {
    useBrowserCardStore.setState(previousBrowserState);
    useTerminalRuntimeStateStore.getState().reset();
    useProjectStore.setState(previousState);
  }
});

test("buildSnapshotState derives stashed terminals from projectStore state", async () => {
  const { buildSnapshotState } = await loadSnapshotRuntimeState("snapshot-stashed");
  const { useBrowserCardStore } = await import("../src/stores/browserCardStore.ts");
  const { useCanvasStore } = await import("../src/stores/canvasStore.ts");
  const { useDrawingStore } = await import("../src/stores/drawingStore.ts");
  const { useProjectStore } = await import("../src/stores/projectStore.ts");
  const { useStashStore } = await import("../src/stores/stashStore.ts");

  useCanvasStore.setState({ viewport: { x: 0, y: 0, scale: 1 } });
  useDrawingStore.setState({ activeElement: null, elements: [] });
  useBrowserCardStore.setState({ cards: {} });
  useStashStore.getState().setItems([]);
  useProjectStore.setState({
    focusedProjectId: null,
    focusedWorktreeId: null,
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
                id: "terminal-stashed",
                title: "Stashed",
                type: "shell",
                minimized: false,
                focused: false,
                ptyId: null,
                status: "idle",
                span: { cols: 1, rows: 1 },
                stashed: true,
                stashedAt: 123,
              },
            ],
          },
        ],
      },
    ],
  });

  const snapshot = buildSnapshotState();
  assert.equal(snapshot.scene.stashedTerminals?.length, 1);
  assert.equal(snapshot.scene.stashedTerminals?.[0]?.terminal.id, "terminal-stashed");
  assert.equal(snapshot.scene.stashedTerminals?.[0]?.stashedAt, 123);
});
