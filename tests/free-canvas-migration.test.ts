import test from "node:test";
import assert from "node:assert/strict";

test("migrateToFreeCanvas converts span to width/height", async () => {
  const { migrateToFreeCanvas } = await import(
    "../src/migration/migrateToFreeCanvas.ts"
  );

  const oldState = {
    projects: [
      {
        id: "p1",
        name: "App",
        path: "/app",
        position: { x: 0, y: 0 },
        collapsed: false,
        zIndex: 1,
        worktrees: [
          {
            id: "w1",
            name: "main",
            path: "/app",
            position: { x: 0, y: 0 },
            collapsed: false,
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
            ],
          },
        ],
      },
    ],
    stashedTerminals: [],
  };

  const result = migrateToFreeCanvas(oldState, { w: 640, h: 480 });
  const terminal = result.projects[0].worktrees[0].terminals[0];

  assert.equal(terminal.width, 2 * 640 + 8);
  assert.equal(terminal.height, 480);
  assert.ok(!("span" in terminal));
  assert.ok(Array.isArray(terminal.tags));
  assert.ok(terminal.tags.includes("project:App"));
  assert.ok(terminal.tags.includes("worktree:main"));
  assert.ok(terminal.tags.includes("type:shell"));
});

test("migrateToFreeCanvas assigns cluster positions", async () => {
  const { migrateToFreeCanvas } = await import(
    "../src/migration/migrateToFreeCanvas.ts"
  );

  const oldState = {
    projects: [
      {
        id: "p1",
        name: "App",
        path: "/app",
        position: { x: 0, y: 0 },
        collapsed: false,
        zIndex: 1,
        worktrees: [
          {
            id: "w1",
            name: "main",
            path: "/app",
            position: { x: 0, y: 0 },
            collapsed: false,
            terminals: [
              {
                id: "t1",
                title: "a",
                type: "shell",
                minimized: false,
                focused: false,
                ptyId: null,
                status: "idle",
                span: { cols: 1, rows: 1 },
              },
              {
                id: "t2",
                title: "b",
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
    stashedTerminals: [],
  };

  const result = migrateToFreeCanvas(oldState, { w: 640, h: 480 });
  const t1 = result.projects[0].worktrees[0].terminals[0];
  const t2 = result.projects[0].worktrees[0].terminals[1];

  assert.equal(typeof t1.x, "number");
  assert.equal(typeof t1.y, "number");
  assert.ok(t1.x !== t2.x || t1.y !== t2.y);
});

test("migrateToFreeCanvas removes project/worktree layout fields", async () => {
  const { migrateToFreeCanvas } = await import(
    "../src/migration/migrateToFreeCanvas.ts"
  );

  const oldState = {
    projects: [
      {
        id: "p1",
        name: "App",
        path: "/app",
        position: { x: 100, y: 200 },
        collapsed: true,
        zIndex: 5,
        worktrees: [
          {
            id: "w1",
            name: "main",
            path: "/app",
            position: { x: 10, y: 20 },
            collapsed: false,
            terminals: [],
          },
        ],
      },
    ],
    stashedTerminals: [],
  };

  const result = migrateToFreeCanvas(oldState, { w: 640, h: 480 });
  const project = result.projects[0];
  const worktree = project.worktrees[0];

  assert.ok(!("position" in project));
  assert.ok(!("collapsed" in project));
  assert.ok(!("zIndex" in project));
  assert.ok(!("position" in worktree));
  assert.ok(!("collapsed" in worktree));
  assert.equal(result.schemaVersion, 2);
});
