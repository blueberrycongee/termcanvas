import test from "node:test";
import assert from "node:assert/strict";

// Provide a minimal window stub for unstashTerminal → setFocusedTerminal,
// which dispatches a CustomEvent on window.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window?: EventTarget }).window = new EventTarget();
}
if (typeof (globalThis as { CustomEvent?: unknown }).CustomEvent === "undefined") {
  class CustomEventPolyfill<T> extends Event {
    detail: T;
    constructor(type: string, init?: { detail?: T }) {
      super(type);
      this.detail = init?.detail as T;
    }
  }
  (globalThis as { CustomEvent?: typeof CustomEventPolyfill }).CustomEvent =
    CustomEventPolyfill;
}

import { useProjectStore, stashTerminal, unstashTerminal } from "../src/stores/projectStore.ts";
import { useClusterStore } from "../src/stores/clusterStore.ts";
import { resolveCollisions } from "../src/canvas/collisionResolver.ts";
import type { ProjectData, TerminalData } from "../src/types/index.ts";

function makeTerminal(
  id: string,
  type: TerminalData["type"],
  x: number,
  y: number,
  tags: string[],
): TerminalData {
  return {
    id,
    title: id,
    type,
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    x,
    y,
    width: 400,
    height: 300,
    tags,
  };
}

function buildScene(): ProjectData[] {
  return [
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
            makeTerminal("t1", "shell", 0, 0, [
              "project:App",
              "worktree:main",
              "type:shell",
            ]),
            makeTerminal("t2", "claude", 500, 0, [
              "project:App",
              "worktree:main",
              "type:claude",
            ]),
          ],
        },
        {
          id: "w2",
          name: "feature",
          path: "/app-feature",
          terminals: [
            makeTerminal("t3", "shell", 0, 500, [
              "project:App",
              "worktree:feature",
              "type:shell",
            ]),
            makeTerminal("t4", "claude", 500, 500, [
              "project:App",
              "worktree:feature",
              "type:claude",
            ]),
          ],
        },
      ],
    },
  ];
}

function reset() {
  useProjectStore.setState({
    projects: buildScene(),
    focusedProjectId: null,
    focusedWorktreeId: null,
  });
  useClusterStore.setState({ lastRule: null, positionSnapshot: null });
}

test("scene scaffolding has tagged free-canvas terminals", () => {
  reset();
  const projects = useProjectStore.getState().projects;
  const flat = projects.flatMap((p) =>
    p.worktrees.flatMap((w) => w.terminals),
  );
  assert.equal(flat.length, 4);
  for (const terminal of flat) {
    assert.equal(typeof terminal.x, "number");
    assert.equal(typeof terminal.y, "number");
    assert.equal(typeof terminal.width, "number");
    assert.equal(typeof terminal.height, "number");
    assert.ok(Array.isArray(terminal.tags));
    assert.ok(terminal.tags.some((tag) => tag.startsWith("project:")));
  }
});

test("clusterByProject groups same-project tiles together", () => {
  reset();
  useClusterStore.getState().applyCluster("by-project");

  const flat = useProjectStore
    .getState()
    .projects.flatMap((p) => p.worktrees.flatMap((w) => w.terminals));

  // All four tiles share project:App so they should be in one row
  const ys = flat.map((t) => t.y);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  assert.ok(ySpread < 1000, `tiles in same project should not be far apart on Y, got ${ySpread}`);
});

test("clusterByType groups same-type tiles together", () => {
  reset();
  useClusterStore.getState().applyCluster("by-type");

  const flat = useProjectStore
    .getState()
    .projects.flatMap((p) => p.worktrees.flatMap((w) => w.terminals));

  const shells = flat.filter((t) => t.type === "shell");
  const claudes = flat.filter((t) => t.type === "claude");

  // Each type group's tiles should be near each other
  const shellDist = Math.hypot(
    shells[0].x - shells[1].x,
    shells[0].y - shells[1].y,
  );
  const claudeDist = Math.hypot(
    claudes[0].x - claudes[1].x,
    claudes[0].y - claudes[1].y,
  );
  const cross = Math.hypot(
    shells[0].x - claudes[0].x,
    shells[0].y - claudes[0].y,
  );
  assert.ok(
    shellDist < cross,
    `same-type shell distance (${shellDist}) should be < cross-type distance (${cross})`,
  );
  assert.ok(
    claudeDist < cross,
    `same-type claude distance (${claudeDist}) should be < cross-type distance (${cross})`,
  );
});

test("collision resolver pushes overlapping tiles apart on simulated drag", () => {
  reset();
  const projects = useProjectStore.getState().projects;
  // Drag t2 onto t1 (heavy overlap)
  const updatedRects = projects.flatMap((p) =>
    p.worktrees.flatMap((w) =>
      w.terminals.map((t) => ({
        id: t.id,
        x: t.id === "t2" ? 0 : t.x,
        y: t.id === "t2" ? 0 : t.y,
        width: t.width,
        height: t.height,
      })),
    ),
  );
  const resolved = resolveCollisions(updatedRects, 8, "t2");
  const t1 = resolved.find((r) => r.id === "t1");
  const t2 = resolved.find((r) => r.id === "t2");
  assert.ok(t1 && t2);

  // The anchor (t2) should remain at (0, 0) and t1 should be pushed away
  assert.equal(t2!.x, 0);
  assert.equal(t2!.y, 0);
  assert.ok(
    t1!.x !== 0 || t1!.y !== 0,
    "t1 should have been nudged out of the way",
  );

  // After resolution, no two tiles should overlap
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i];
      const b = resolved[j];
      const overlapX =
        a.x < b.x + b.width + 8 && a.x + a.width + 8 > b.x;
      const overlapY =
        a.y < b.y + b.height + 8 && a.y + a.height + 8 > b.y;
      assert.ok(
        !(overlapX && overlapY),
        `tiles ${a.id} and ${b.id} still overlap after resolveCollisions`,
      );
    }
  }
});

test("stash hides terminal and unstash restores its position", () => {
  reset();
  const before = useProjectStore.getState().projects[0].worktrees[0]
    .terminals[0];
  const originalX = before.x;
  const originalY = before.y;

  stashTerminal("p1", "w1", "t1");
  let t1 = useProjectStore
    .getState()
    .projects[0].worktrees[0].terminals.find((t) => t.id === "t1");
  assert.ok(t1?.stashed, "t1 should be stashed");
  assert.equal(t1?.x, originalX, "stashed terminal keeps its x");
  assert.equal(t1?.y, originalY, "stashed terminal keeps its y");

  unstashTerminal("t1");
  t1 = useProjectStore
    .getState()
    .projects[0].worktrees[0].terminals.find((t) => t.id === "t1");
  assert.ok(t1 && !t1.stashed, "t1 should no longer be stashed");
  // Position should be restored — t2 is at (500, 0) and t1 was at (0, 0),
  // so no collision and no nudge.
  assert.equal(t1!.x, originalX);
  assert.equal(t1!.y, originalY);
});

test("undoCluster restores positions after clustering", () => {
  reset();
  const before = useProjectStore
    .getState()
    .projects.flatMap((p) =>
      p.worktrees.flatMap((w) =>
        w.terminals.map((t) => ({ id: t.id, x: t.x, y: t.y })),
      ),
    );

  useClusterStore.getState().applyCluster("by-type");
  useClusterStore.getState().undoCluster();

  const after = useProjectStore
    .getState()
    .projects.flatMap((p) =>
      p.worktrees.flatMap((w) =>
        w.terminals.map((t) => ({ id: t.id, x: t.x, y: t.y })),
      ),
    );

  for (const original of before) {
    const restored = after.find((entry) => entry.id === original.id);
    assert.ok(restored);
    assert.equal(restored!.x, original.x);
    assert.equal(restored!.y, original.y);
  }
});
