import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ProjectStore, generateId } from "../headless-runtime/project-store.ts";
import type { ProjectData } from "../headless-runtime/project-store.ts";

function makeProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    id: generateId(),
    name: "test-project",
    path: "/tmp/test-project",
    position: { x: 0, y: 0 },
    collapsed: false,
    zIndex: 0,
    worktrees: [
      {
        id: generateId(),
        name: "main",
        path: "/tmp/test-project",
        position: { x: 0, y: 0 },
        collapsed: false,
        terminals: [],
      },
    ],
    ...overrides,
  };
}

describe("ProjectStore", () => {
  let store: ProjectStore;

  beforeEach(() => {
    store = new ProjectStore();
  });

  describe("project CRUD", () => {
    it("addProject + getProjects", () => {
      const project = makeProject();
      store.addProject(project);
      const projects = store.getProjects();
      assert.equal(projects.length, 1);
      assert.equal(projects[0].id, project.id);
      assert.equal(projects[0].name, "test-project");
    });

    it("removeProject", () => {
      const p1 = makeProject({ name: "first" });
      const p2 = makeProject({ name: "second", path: "/tmp/second" });
      store.addProject(p1);
      store.addProject(p2);
      assert.equal(store.getProjects().length, 2);

      store.removeProject(p1.id);
      const remaining = store.getProjects();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].name, "second");
    });

    it("getProjectById", () => {
      const project = makeProject();
      store.addProject(project);
      assert.equal(store.getProjectById(project.id)?.name, "test-project");
      assert.equal(store.getProjectById("nonexistent"), undefined);
    });

    it("findProjectByPath", () => {
      const project = makeProject({ path: "/home/user/repo" });
      store.addProject(project);
      assert.equal(store.findProjectByPath("/home/user/repo")?.id, project.id);
      assert.equal(store.findProjectByPath("/nonexistent"), undefined);
    });
  });

  describe("terminal CRUD", () => {
    let projectId: string;
    let worktreeId: string;

    beforeEach(() => {
      const project = makeProject();
      projectId = project.id;
      worktreeId = project.worktrees[0].id;
      store.addProject(project);
    });

    it("addTerminal + getTerminal returns enriched data", () => {
      const terminal = store.addTerminal(projectId, worktreeId, "claude", "hello");
      assert.equal(terminal.type, "claude");
      assert.equal(terminal.title, "claude");
      assert.equal(terminal.initialPrompt, "hello");

      const enriched = store.getTerminal(terminal.id);
      assert.ok(enriched);
      assert.equal(enriched.projectId, projectId);
      assert.equal(enriched.worktreeId, worktreeId);
      assert.equal(enriched.worktreePath, "/tmp/test-project");
      assert.equal(enriched.type, "claude");
    });

    it("addTerminal shell gets correct title", () => {
      const terminal = store.addTerminal(projectId, worktreeId, "shell");
      assert.equal(terminal.title, "Terminal");
    });

    it("removeTerminal", () => {
      const t1 = store.addTerminal(projectId, worktreeId, "shell");
      const t2 = store.addTerminal(projectId, worktreeId, "claude");
      assert.equal(store.listTerminals().length, 2);

      store.removeTerminal(projectId, worktreeId, t1.id);
      const remaining = store.listTerminals();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].id, t2.id);
    });

    it("listTerminals with worktree filter", () => {
      store.addTerminal(projectId, worktreeId, "shell");

      const p2 = makeProject({
        path: "/tmp/other",
        worktrees: [
          {
            id: generateId(),
            name: "dev",
            path: "/tmp/other",
            position: { x: 0, y: 0 },
            collapsed: false,
            terminals: [],
          },
        ],
      });
      store.addProject(p2);
      store.addTerminal(p2.id, p2.worktrees[0].id, "claude");

      assert.equal(store.listTerminals().length, 2);

      const filtered = store.listTerminals("/tmp/test-project");
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].worktree, "/tmp/test-project");
    });

    it("setCustomTitle", () => {
      const terminal = store.addTerminal(projectId, worktreeId, "shell");
      const result = store.setCustomTitle(terminal.id, "My Terminal");
      assert.equal(result, true);

      const enriched = store.getTerminal(terminal.id);
      assert.equal(enriched?.customTitle, "My Terminal");
    });

    it("setCustomTitle returns false for unknown terminal", () => {
      assert.equal(store.setCustomTitle("nonexistent", "title"), false);
    });

    it("setCustomTitle trims whitespace-only to undefined", () => {
      const terminal = store.addTerminal(projectId, worktreeId, "shell");
      store.setCustomTitle(terminal.id, "  ");
      const enriched = store.getTerminal(terminal.id);
      assert.equal(enriched?.customTitle, undefined);
    });

    it("updateTerminalPtyId", () => {
      const terminal = store.addTerminal(projectId, worktreeId, "shell");
      assert.equal(store.getTerminal(terminal.id)?.ptyId, null);

      store.updateTerminalPtyId(projectId, worktreeId, terminal.id, 42);
      assert.equal(store.getTerminal(terminal.id)?.ptyId, 42);
    });

    it("updateTerminalStatus", () => {
      const terminal = store.addTerminal(projectId, worktreeId, "claude");
      assert.equal(store.getTerminal(terminal.id)?.status, "idle");

      store.updateTerminalStatus(projectId, worktreeId, terminal.id, "running");
      assert.equal(store.getTerminal(terminal.id)?.status, "running");
    });

    it("getTerminal returns null for unknown id", () => {
      assert.equal(store.getTerminal("nonexistent"), null);
    });
  });

  describe("syncWorktrees", () => {
    it("adds new worktrees and removes stale ones", () => {
      const project = makeProject({
        path: "/repo",
        worktrees: [
          {
            id: "wt-old",
            name: "main",
            path: "/repo",
            position: { x: 0, y: 0 },
            collapsed: false,
            terminals: [],
          },
          {
            id: "wt-stale",
            name: "stale-branch",
            path: "/repo/.worktrees/stale",
            position: { x: 0, y: 0 },
            collapsed: false,
            terminals: [],
          },
        ],
      });
      store.addProject(project);

      store.syncWorktrees("/repo", [
        { path: "/repo", branch: "main", isMain: true },
        { path: "/repo/.worktrees/new-feature", branch: "new-feature", isMain: false },
      ]);

      const updated = store.getProjects()[0];
      assert.equal(updated.worktrees.length, 2);
      assert.equal(updated.worktrees[0].path, "/repo");
      assert.equal(updated.worktrees[0].id, "wt-old"); // preserved existing
      assert.equal(updated.worktrees[1].path, "/repo/.worktrees/new-feature");
      assert.equal(updated.worktrees[1].name, "new-feature");
    });

    it("updates branch name for existing worktree", () => {
      const project = makeProject({
        path: "/repo",
        worktrees: [
          {
            id: "wt-1",
            name: "old-name",
            path: "/repo",
            position: { x: 0, y: 0 },
            collapsed: false,
            terminals: [],
          },
        ],
      });
      store.addProject(project);

      store.syncWorktrees("/repo", [
        { path: "/repo", branch: "new-name", isMain: true },
      ]);

      const updated = store.getProjects()[0];
      assert.equal(updated.worktrees[0].name, "new-name");
      assert.equal(updated.worktrees[0].id, "wt-1"); // id preserved
    });

    it("does not affect other projects", () => {
      const p1 = makeProject({ path: "/repo1" });
      const p2 = makeProject({ path: "/repo2" });
      store.addProject(p1);
      store.addProject(p2);

      store.syncWorktrees("/repo1", []);
      assert.equal(store.getProjects()[0].worktrees.length, 0);
      assert.equal(store.getProjects()[1].worktrees.length, 1); // unchanged
    });
  });

  describe("findWorktree", () => {
    it("finds worktree by path", () => {
      const project = makeProject();
      store.addProject(project);
      const result = store.findWorktree("/tmp/test-project");
      assert.ok(result);
      assert.equal(result.projectId, project.id);
      assert.equal(result.worktreeId, project.worktrees[0].id);
    });

    it("returns null for unknown path", () => {
      assert.equal(store.findWorktree("/unknown"), null);
    });
  });
});
