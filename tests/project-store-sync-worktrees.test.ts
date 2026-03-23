import test from "node:test";
import assert from "node:assert/strict";

import { useProjectStore } from "../src/stores/projectStore.ts";
import type { ProjectData } from "../src/types/index.ts";

function createProject(): ProjectData {
  return {
    id: "project-1",
    name: "Project One",
    path: "/tmp/project-1",
    position: { x: 0, y: 0 },
    collapsed: false,
    zIndex: 1,
    worktrees: [
      {
        id: "worktree-main",
        name: "main",
        path: "/tmp/project-1",
        position: { x: 10, y: 20 },
        collapsed: false,
        terminals: [
          {
            id: "terminal-1",
            title: "Terminal 1",
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
  };
}

function resetStore(projects: ProjectData[]) {
  useProjectStore.setState({
    projects,
    focusedProjectId: null,
    focusedWorktreeId: null,
  });
}

test("syncWorktrees no-op keeps references and does not notify subscribers", () => {
  const project = createProject();
  resetStore([project]);

  const beforeProjects = useProjectStore.getState().projects;
  const beforeProject = beforeProjects[0];
  const beforeWorktree = beforeProject.worktrees[0];

  let notifications = 0;
  const unsubscribe = useProjectStore.subscribe(() => {
    notifications += 1;
  });

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
    { path: "/tmp/project-1", branch: "main", isMain: true },
  ]);
  unsubscribe();

  const afterProjects = useProjectStore.getState().projects;
  assert.equal(notifications, 0);
  assert.strictEqual(afterProjects, beforeProjects);
  assert.strictEqual(afterProjects[0], beforeProject);
  assert.strictEqual(afterProjects[0].worktrees[0], beforeWorktree);
});

test("syncWorktrees still updates renamed branches", () => {
  resetStore([createProject()]);

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
    { path: "/tmp/project-1", branch: "feature/new-name", isMain: true },
  ]);

  const state = useProjectStore.getState();
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].worktrees.length, 1);
  assert.equal(state.projects[0].worktrees[0].name, "feature/new-name");
  assert.equal(state.projects[0].worktrees[0].path, "/tmp/project-1");
});

test("syncWorktrees still adds and removes worktrees", () => {
  resetStore([createProject()]);

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
    { path: "/tmp/project-1", branch: "main", isMain: true },
    { path: "/tmp/project-1-feature", branch: "feature", isMain: false },
  ]);

  let state = useProjectStore.getState();
  assert.equal(state.projects[0].worktrees.length, 2);
  const feature = state.projects[0].worktrees.find(
    (worktree) => worktree.path === "/tmp/project-1-feature",
  );
  assert.ok(feature);
  assert.equal(feature!.collapsed, true);
  assert.deepEqual(feature!.position, { x: 0, y: 0 });
  assert.deepEqual(feature!.terminals, []);

  useProjectStore.getState().syncWorktrees("/tmp/project-1", [
    { path: "/tmp/project-1-feature", branch: "feature", isMain: true },
  ]);

  state = useProjectStore.getState();
  assert.equal(state.projects[0].worktrees.length, 1);
  assert.equal(state.projects[0].worktrees[0].path, "/tmp/project-1-feature");
  assert.equal(state.projects[0].worktrees[0].name, "feature");
});
