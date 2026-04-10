import test from "node:test";
import assert from "node:assert/strict";

import { useProjectStore } from "../src/stores/projectStore.ts";
import { useClusterStore } from "../src/stores/clusterStore.ts";
import type { ProjectData, TerminalData } from "../src/types/index.ts";

function makeTerminal(
  id: string,
  x: number,
  y: number,
  tags: string[],
): TerminalData {
  return {
    id,
    title: id,
    type: "shell",
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

function makeProjects(): ProjectData[] {
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
            makeTerminal("t1", 1000, 1000, ["project:App", "type:shell"]),
            makeTerminal("t2", 2000, 2000, ["project:App", "type:claude"]),
          ],
        },
      ],
    },
    {
      id: "p2",
      name: "Backend",
      path: "/backend",
      worktrees: [
        {
          id: "w2",
          name: "main",
          path: "/backend",
          terminals: [
            makeTerminal("t3", 3000, 3000, ["project:Backend", "type:shell"]),
          ],
        },
      ],
    },
  ];
}

function reset() {
  useProjectStore.setState({
    projects: makeProjects(),
    focusedProjectId: null,
    focusedWorktreeId: null,
  });
  useClusterStore.setState({ lastRule: null, positionSnapshot: null });
}

test("applyCluster snapshots positions and rewrites them", () => {
  reset();
  const before = useProjectStore
    .getState()
    .projects.flatMap((p) =>
      p.worktrees.flatMap((w) => w.terminals.map((t) => ({ id: t.id, x: t.x, y: t.y }))),
    );

  useClusterStore.getState().applyCluster("by-project");

  const snapshot = useClusterStore.getState().positionSnapshot;
  assert.ok(snapshot, "snapshot should be saved");
  assert.equal(snapshot!["t1"].x, 1000);
  assert.equal(snapshot!["t1"].y, 1000);

  const after = useProjectStore
    .getState()
    .projects.flatMap((p) =>
      p.worktrees.flatMap((w) => w.terminals.map((t) => ({ id: t.id, x: t.x, y: t.y }))),
    );

  // At least one terminal should have moved
  const moved = after.some((entry) => {
    const original = before.find((b) => b.id === entry.id);
    return original && (original.x !== entry.x || original.y !== entry.y);
  });
  assert.ok(moved, "applyCluster should move terminals");

  assert.equal(useClusterStore.getState().lastRule, "by-project");
});

test("undoCluster restores prior positions", () => {
  reset();
  useClusterStore.getState().applyCluster("by-type");
  useClusterStore.getState().undoCluster();

  const projects = useProjectStore.getState().projects;
  const t1 = projects[0].worktrees[0].terminals[0];
  const t2 = projects[0].worktrees[0].terminals[1];
  const t3 = projects[1].worktrees[0].terminals[0];

  assert.equal(t1.x, 1000);
  assert.equal(t1.y, 1000);
  assert.equal(t2.x, 2000);
  assert.equal(t2.y, 2000);
  assert.equal(t3.x, 3000);
  assert.equal(t3.y, 3000);

  assert.equal(useClusterStore.getState().positionSnapshot, null);
  assert.equal(useClusterStore.getState().lastRule, null);
});

test("canUndo reflects snapshot presence", () => {
  reset();
  assert.equal(useClusterStore.getState().canUndo(), false);
  useClusterStore.getState().applyCluster("by-project");
  assert.equal(useClusterStore.getState().canUndo(), true);
  useClusterStore.getState().undoCluster();
  assert.equal(useClusterStore.getState().canUndo(), false);
});
