import test from "node:test";
import assert from "node:assert/strict";

import { readWorkspaceSnapshot } from "../src/snapshotBridge.ts";

test("readWorkspaceSnapshot migrates legacy v1 terminals to free-canvas shape", () => {
  const legacySnapshot = {
    version: 1,
    viewport: { x: 0, y: 0, scale: 1 },
    drawings: [],
    browserCards: {},
    projects: [
      {
        id: "p1",
        name: "App",
        path: "/app",
        worktrees: [
          {
            id: "w1",
            name: "main",
            path: "/app",
            terminals: [
              {
                id: "t1",
                title: "shell",
                type: "shell",
                minimized: false,
                focused: false,
                ptyId: null,
                status: "idle",
                span: { cols: 2, rows: 1 },
              },
              {
                id: "t2",
                title: "claude",
                type: "claude",
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
  };

  const restored = readWorkspaceSnapshot(legacySnapshot);
  assert.ok(restored && "scene" in restored);
  const projects = restored.scene.projects;
  assert.equal(projects.length, 1);

  const terminals = projects[0].worktrees[0].terminals;
  assert.equal(terminals.length, 2);

  const t1 = terminals.find((t) => t.id === "t1");
  const t2 = terminals.find((t) => t.id === "t2");
  assert.ok(t1 && t2);

  // Width derived from span (2 cols * 640 + 8 = 1288)
  assert.equal(t1.width, 1288);
  assert.equal(t1.height, 480);
  assert.equal(t2.width, 640);
  assert.equal(t2.height, 480);

  // Auto tags should be generated
  assert.ok(t1.tags.includes("project:App"));
  assert.ok(t1.tags.includes("worktree:main"));
  assert.ok(t1.tags.includes("type:shell"));
  assert.ok(t2.tags.includes("type:claude"));

  // Positions should be assigned (cluster placement, not 0,0 collision)
  assert.equal(typeof t1.x, "number");
  assert.equal(typeof t1.y, "number");
  // Both terminals should have distinct positions
  assert.ok(t1.x !== t2.x || t1.y !== t2.y);
});

test("readWorkspaceSnapshot preserves explicit free-canvas v2 fields", () => {
  const v2Snapshot = {
    version: 2,
    scene: {
      version: 2,
      camera: { x: 0, y: 0, zoom: 1 },
      browserCards: {},
      annotations: [],
      projects: [
        {
          id: "p1",
          name: "App",
          path: "/app",
          worktrees: [
            {
              id: "w1",
              name: "main",
              path: "/app",
              terminals: [
                {
                  id: "t1",
                  title: "shell",
                  type: "shell",
                  minimized: false,
                  focused: false,
                  ptyId: null,
                  status: "idle",
                  x: 1234,
                  y: 5678,
                  width: 800,
                  height: 600,
                  tags: ["project:App", "custom:foo"],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const restored = readWorkspaceSnapshot(v2Snapshot);
  assert.ok(restored && "scene" in restored);
  const terminal = restored.scene.projects[0].worktrees[0].terminals[0];
  assert.equal(terminal.x, 1234);
  assert.equal(terminal.y, 5678);
  assert.equal(terminal.width, 800);
  assert.equal(terminal.height, 600);
  assert.ok(terminal.tags.includes("custom:foo"));
});
