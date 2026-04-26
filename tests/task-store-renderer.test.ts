import test from "node:test";
import assert from "node:assert/strict";

import { useTaskStore } from "../src/stores/taskStore.ts";
import type { Task } from "../src/types/index.ts";

function makeTask(overrides: Partial<Task> & { id: string; repo: string; title: string }): Task {
  return {
    id: overrides.id,
    title: overrides.title,
    status: overrides.status ?? "open",
    repo: overrides.repo,
    body: overrides.body ?? "",
    links: overrides.links ?? [],
    created: overrides.created ?? "2026-01-01T00:00:00Z",
    updated: overrides.updated ?? "2026-01-01T00:00:00Z",
  };
}

function resetTaskStore() {
  useTaskStore.setState({
    tasksByProject: {},
    openProjectPath: null,
    openDetailTaskId: null,
    composingForProject: null,
    terminalTaskMap: {},
    showCompleted: false,
  });
}

test("assignTaskToTerminal sets the entry; clearTerminalAssignment removes it", () => {
  resetTaskStore();
  const task = makeTask({ id: "task-a", repo: "/repo", title: "First" });

  useTaskStore.getState().assignTaskToTerminal("term-1", task);
  assert.deepEqual(useTaskStore.getState().terminalTaskMap, {
    "term-1": { taskId: "task-a", repo: "/repo", title: "First" },
  });

  useTaskStore.getState().clearTerminalAssignment("term-1");
  assert.deepEqual(useTaskStore.getState().terminalTaskMap, {});
});

test("assigning a different task to the same terminal replaces (no accumulation)", () => {
  resetTaskStore();
  const a = makeTask({ id: "task-a", repo: "/repo", title: "First" });
  const b = makeTask({ id: "task-b", repo: "/repo", title: "Second" });

  useTaskStore.getState().assignTaskToTerminal("term-1", a);
  useTaskStore.getState().assignTaskToTerminal("term-1", b);

  assert.deepEqual(useTaskStore.getState().terminalTaskMap, {
    "term-1": { taskId: "task-b", repo: "/repo", title: "Second" },
  });
});

test("removeTask clears any matching terminal assignment", () => {
  resetTaskStore();
  const task = makeTask({ id: "task-a", repo: "/repo", title: "Linked" });
  useTaskStore.setState({ tasksByProject: { "/repo": [task] } });
  useTaskStore.getState().assignTaskToTerminal("term-1", task);
  useTaskStore.getState().assignTaskToTerminal("term-2", task);

  useTaskStore.getState().removeTask("/repo", "task-a");

  assert.deepEqual(useTaskStore.getState().terminalTaskMap, {});
  assert.equal(
    useTaskStore.getState().tasksByProject["/repo"].find((t) => t.id === "task-a"),
    undefined,
  );
});

test("upsertTask refreshes cached title on existing terminal assignments", () => {
  resetTaskStore();
  const initial = makeTask({ id: "task-a", repo: "/repo", title: "Original" });
  useTaskStore.setState({ tasksByProject: { "/repo": [initial] } });
  useTaskStore.getState().assignTaskToTerminal("term-1", initial);

  const renamed = makeTask({ id: "task-a", repo: "/repo", title: "Renamed" });
  useTaskStore.getState().upsertTask("/repo", renamed);

  assert.equal(
    useTaskStore.getState().terminalTaskMap["term-1"].title,
    "Renamed",
  );
});

test("upsertTask leaves terminalTaskMap reference stable when title is unchanged", () => {
  resetTaskStore();
  const task = makeTask({ id: "task-a", repo: "/repo", title: "Same" });
  useTaskStore.setState({ tasksByProject: { "/repo": [task] } });
  useTaskStore.getState().assignTaskToTerminal("term-1", task);
  const before = useTaskStore.getState().terminalTaskMap;

  // Body change but same title → terminalTaskMap should not be re-allocated.
  useTaskStore.getState().upsertTask(
    "/repo",
    makeTask({ id: "task-a", repo: "/repo", title: "Same", body: "edited" }),
  );

  assert.equal(useTaskStore.getState().terminalTaskMap, before);
});

test("toggleShowCompleted flips the boolean; setShowCompleted assigns directly", () => {
  resetTaskStore();
  assert.equal(useTaskStore.getState().showCompleted, false);

  useTaskStore.getState().toggleShowCompleted();
  assert.equal(useTaskStore.getState().showCompleted, true);

  useTaskStore.getState().toggleShowCompleted();
  assert.equal(useTaskStore.getState().showCompleted, false);

  useTaskStore.getState().setShowCompleted(true);
  assert.equal(useTaskStore.getState().showCompleted, true);
});
