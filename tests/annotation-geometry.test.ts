import test from "node:test";
import assert from "node:assert/strict";

function installAnnotationGeometryGlobals() {
  const storage = new Map<string, string>();
  const navigator = {
    language: "en-US",
    userAgent: "node-test",
  };
  const target = new EventTarget();
  const mockWindow = Object.assign(target, {
    navigator,
    innerWidth: 1440,
    innerHeight: 900,
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

test("resolveDrawingElementForRender projects entity-anchored annotations onto current entity positions", async () => {
  installAnnotationGeometryGlobals();
  const { resolveDrawingElementForRender } = await import(
    "../src/canvas/annotationGeometry.ts"
  );
  const { publishTerminalGeometry } = await import(
    "../src/terminal/terminalGeometryRegistry.ts"
  );

  try {
    const projects = [
      {
        id: "project-1",
        name: "Project One",
        path: "/tmp/project-1",
        position: { x: 120, y: 80 },
        collapsed: false,
        zIndex: 1,
        worktrees: [
          {
            id: "worktree-1",
            name: "main",
            path: "/tmp/project-1",
            position: { x: 24, y: 48 },
            collapsed: false,
            terminals: [
              {
                id: "terminal-1",
                title: "Terminal",
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
    ];

    const anchoredText = resolveDrawingElementForRender(
      {
        id: "annotation-1",
        type: "text",
        x: 0,
        y: 0,
        content: "hello",
        color: "#fff",
        fontSize: 14,
        anchor: {
          kind: "entity",
          entityId: "project-1",
          offset: { x: 16, y: 20 },
        },
      },
      projects,
    );

    assert.equal(anchoredText.type, "text");
    assert.deepEqual(
      { x: anchoredText.x, y: anchoredText.y },
      { x: 136, y: 100 },
    );

    publishTerminalGeometry({
      terminalId: "terminal-1",
      projectId: "project-1",
      worktreeId: "worktree-1",
      x: 400,
      y: 260,
      w: 640,
      h: 480,
    });

    const anchoredRect = resolveDrawingElementForRender(
      {
        id: "annotation-2",
        type: "rect",
        x: 0,
        y: 0,
        w: 80,
        h: 50,
        color: "#fff",
        strokeWidth: 2,
        anchor: {
          kind: "entity",
          entityId: "terminal-1",
          offset: { x: 12, y: 24 },
        },
      },
      projects,
    );

    assert.equal(anchoredRect.type, "rect");
    assert.deepEqual(
      { x: anchoredRect.x, y: anchoredRect.y },
      { x: 412, y: 284 },
    );
  } finally {
    const { clearTerminalGeometryRegistry } = await import(
      "../src/terminal/terminalGeometryRegistry.ts"
    );
    clearTerminalGeometryRegistry();
  }
});
