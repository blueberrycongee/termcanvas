import test from "node:test";
import assert from "node:assert/strict";

import type { ProjectData } from "../src/types/index.ts";

function installCanvasProjectionGlobals() {
  const storage = new Map<string, string>();
  const localStorage = {
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
  };
  const navigator = {
    language: "en-US",
    userAgent: "node-test",
  };
  const target = new EventTarget();
  const mockWindow = Object.assign(target, {
    navigator,
    localStorage,
  }) as Window;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
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

function createProjects(): ProjectData[] {
  return [
    {
      id: "project-1",
      name: "Project One",
      path: "/tmp/project-1",
      position: { x: 120, y: 80 },
      collapsed: false,
      zIndex: 3,
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
              title: "Terminal 1",
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
  ];
}

test("buildSceneDocumentFromLegacyState maps camera, projects, cards, and annotations", async () => {
  installCanvasProjectionGlobals();
  const { buildSceneDocumentFromLegacyState } = await import(
    "../src/canvas/sceneProjection.ts"
  );
  const scene = buildSceneDocumentFromLegacyState({
    viewport: { x: 10, y: 20, scale: 0.75 },
    projects: createProjects(),
    browserCards: {
      "card-1": {
        id: "card-1",
        url: "https://example.com",
        title: "Example",
        x: 40,
        y: 50,
        w: 320,
        h: 240,
      },
    },
    drawings: [
      {
        id: "drawing-1",
        type: "rect",
        x: 300,
        y: 400,
        w: 120,
        h: 60,
        color: "#fff",
        strokeWidth: 3,
      },
    ],
  });

  assert.equal(scene.version, 2);
  assert.deepEqual(scene.camera, { x: 10, y: 20, zoom: 0.75 });
  assert.equal(scene.projects.length, 1);
  assert.equal(scene.projects[0].id, "project-1");
  assert.equal(scene.browserCards["card-1"]?.id, "card-1");
  assert.deepEqual(scene.annotations[0], {
    id: "drawing-1",
    type: "rect",
    anchor: {
      kind: "world",
      position: { x: 300, y: 400 },
    },
    color: "#fff",
    strokeWidth: 3,
    width: 120,
    height: 60,
  });
});

test("buildCanvasFlowNodes creates project/worktree nodes with parent-child mapping", async () => {
  installCanvasProjectionGlobals();
  const {
    buildCanvasFlowNodes,
    projectNodeId,
    worktreeNodeId,
  } = await import("../src/canvas/nodeProjection.ts");
  const [projectNode, worktreeNode] = buildCanvasFlowNodes(createProjects());

  assert.equal(projectNode.id, projectNodeId("project-1"));
  assert.equal(projectNode.type, "project");
  assert.deepEqual(projectNode.position, { x: 120, y: 80 });
  assert.equal(projectNode.data.projectId, "project-1");
  assert.equal(projectNode.dragHandle, ".tc-project-drag-handle");
  assert.equal(projectNode.zIndex, 3);

  assert.equal(worktreeNode.id, worktreeNodeId("worktree-1"));
  assert.equal(worktreeNode.type, "worktree");
  assert.equal(worktreeNode.parentId, projectNode.id);
  assert.deepEqual(worktreeNode.position, { x: 36, y: 100 });
  assert.equal(worktreeNode.data.projectId, "project-1");
  assert.equal(worktreeNode.data.worktreeId, "worktree-1");
  assert.equal(worktreeNode.dragHandle, ".tc-worktree-drag-handle");
  assert.equal(worktreeNode.hidden, false);
});

test("buildCanvasFlowNodes ignores stashed terminals when sizing nodes", async () => {
  installCanvasProjectionGlobals();
  const { buildCanvasFlowNodes } = await import("../src/canvas/nodeProjection.ts");

  const visibleOnlyProjects = createProjects();
  const projectsWithStashed = createProjects();
  projectsWithStashed[0]!.worktrees[0]!.terminals.push({
    id: "terminal-stashed",
    title: "Stashed Terminal",
    type: "shell",
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    stashed: true,
    span: { cols: 3, rows: 2 },
  });

  const visibleOnlyNodes = buildCanvasFlowNodes(visibleOnlyProjects);
  const nodesWithStashed = buildCanvasFlowNodes(projectsWithStashed);
  const visibleOnlyProjectNode = visibleOnlyNodes.find((node) => node.type === "project");
  const visibleOnlyWorktreeNode = visibleOnlyNodes.find((node) => node.type === "worktree");
  const stashedProjectNode = nodesWithStashed.find((node) => node.type === "project");
  const stashedWorktreeNode = nodesWithStashed.find((node) => node.type === "worktree");

  assert.equal(stashedProjectNode?.width, visibleOnlyProjectNode?.width);
  assert.equal(stashedProjectNode?.height, visibleOnlyProjectNode?.height);
  assert.equal(stashedWorktreeNode?.width, visibleOnlyWorktreeNode?.width);
  assert.equal(stashedWorktreeNode?.height, visibleOnlyWorktreeNode?.height);
});

test("getCanvasRendererMode defaults to xyflow and honors explicit legacy override", async () => {
  installCanvasProjectionGlobals();
  const { getCanvasRendererMode } = await import("../src/canvas/rendererMode.ts");

  assert.equal(getCanvasRendererMode(), "xyflow");

  localStorage.setItem("termcanvas-canvas-renderer", "legacy");
  assert.equal(getCanvasRendererMode(), "legacy");

  localStorage.setItem("termcanvas-canvas-renderer", "xyflow");
  assert.equal(getCanvasRendererMode(), "xyflow");
});
