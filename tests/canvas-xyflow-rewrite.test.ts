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
    innerHeight: 900,
    innerWidth: 1440,
    navigator,
    localStorage,
    termcanvas: undefined,
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

async function loadCanvasModules(tag: string) {
  installCanvasProjectionGlobals();

  const sceneProjection = await import(`../src/canvas/sceneProjection.ts?${tag}`);
  const nodeProjection = await import(`../src/canvas/nodeProjection.ts?${tag}`);
  const sceneState = await import(`../src/canvas/sceneState.ts?${tag}`);

  return {
    ...sceneProjection,
    ...nodeProjection,
    ...sceneState,
  };
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

test("sceneState render helpers ignore stashed terminals", async () => {
  const {
    getRenderableTerminalLayouts,
    getRenderableWorktreeSize,
  } = await loadCanvasModules("renderable-terminals");
  const worktree = {
    id: "worktree-1",
    name: "main",
    path: "/tmp/project-1",
    position: { x: 0, y: 0 },
    collapsed: false,
    terminals: [
      {
        id: "terminal-visible-1",
        title: "Visible 1",
        type: "shell" as const,
        minimized: false,
        focused: false,
        ptyId: null,
        status: "idle" as const,
        span: { cols: 1, rows: 1 },
      },
      {
        id: "terminal-stashed",
        title: "Stashed",
        type: "shell" as const,
        minimized: false,
        focused: false,
        ptyId: null,
        status: "idle" as const,
        span: { cols: 2, rows: 1 },
        stashed: true,
      },
      {
        id: "terminal-visible-2",
        title: "Visible 2",
        type: "shell" as const,
        minimized: false,
        focused: false,
        ptyId: null,
        status: "idle" as const,
        span: { cols: 1, rows: 1 },
      },
    ],
  };

  const layouts = getRenderableTerminalLayouts(worktree);
  assert.deepEqual(
    layouts.map(({ terminal }) => terminal.id),
    ["terminal-visible-1", "terminal-visible-2"],
  );

  const size = getRenderableWorktreeSize(worktree);
  assert.equal(size.w >= 300, true);
  assert.equal(size.h > 36, true);
});

test("filterValidSelectedItems drops removed and stashed scene selections", async () => {
  const { filterValidSelectedItems } = await loadCanvasModules("selection-filter");
  const projects: ProjectData[] = [
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
              id: "terminal-visible",
              title: "Visible",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: null,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
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
            },
          ],
        },
      ],
    },
  ];

  const selectedItems = filterValidSelectedItems(
    [
      { type: "project", projectId: "project-1" },
      {
        type: "terminal",
        projectId: "project-1",
        worktreeId: "worktree-1",
        terminalId: "terminal-visible",
      },
      {
        type: "terminal",
        projectId: "project-1",
        worktreeId: "worktree-1",
        terminalId: "terminal-stashed",
      },
      { type: "card", cardId: "browser-1" },
      { type: "annotation", annotationId: "annotation-1" },
    ],
    {
      annotations: [
        {
          id: "annotation-1",
          type: "text",
          x: 10,
          y: 20,
          content: "hello",
          color: "#fff",
          fontSize: 14,
        },
      ],
      cards: {
        "browser-1": {
          id: "browser-1",
          url: "https://example.com",
          title: "Example",
          x: 0,
          y: 0,
          w: 320,
          h: 240,
        },
      },
      projects,
    },
  );

  assert.deepEqual(selectedItems, [
    { type: "project", projectId: "project-1" },
    {
      type: "terminal",
      projectId: "project-1",
      worktreeId: "worktree-1",
      terminalId: "terminal-visible",
    },
    { type: "card", cardId: "browser-1" },
    { type: "annotation", annotationId: "annotation-1" },
  ]);
});
