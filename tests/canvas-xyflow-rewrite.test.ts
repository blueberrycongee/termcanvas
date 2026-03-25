import test from "node:test";
import assert from "node:assert/strict";

import { buildSceneDocumentFromLegacyState } from "../src/canvas/sceneProjection.ts";
import {
  buildCanvasFlowNodes,
  projectNodeId,
  worktreeNodeId,
} from "../src/canvas/nodeProjection.ts";
import type { ProjectData } from "../src/types/index.ts";

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

test("buildSceneDocumentFromLegacyState maps camera, projects, cards, and annotations", () => {
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

test("buildCanvasFlowNodes creates project/worktree nodes with parent-child mapping", () => {
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
