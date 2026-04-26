import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveCanvasProjectRoot } from "../electron/pin-project-resolver.ts";

const GATE_MSG =
  "This repo is not on the TermCanvas canvas. Add it as a project first.";

function makeProject(projectPath: string, worktreePaths: string[] = []) {
  return {
    path: projectPath,
    worktrees: worktreePaths.map((p) => ({ path: p })),
  };
}

test("input === project.path returns project.path", () => {
  const projects = [makeProject("/home/user/myrepo")];
  const result = resolveCanvasProjectRoot("/home/user/myrepo", projects);
  assert.equal(result, "/home/user/myrepo");
});

test("input === worktree.path returns parent project.path", () => {
  const projects = [
    makeProject("/home/user/myrepo", ["/home/user/myrepo/.worktrees/feat"]),
  ];
  const result = resolveCanvasProjectRoot(
    "/home/user/myrepo/.worktrees/feat",
    projects,
  );
  assert.equal(result, "/home/user/myrepo");
});

test("input with trailing slash still resolves via path.resolve normalization", () => {
  const projects = [makeProject("/home/user/myrepo")];
  const result = resolveCanvasProjectRoot("/home/user/myrepo/", projects);
  assert.equal(result, "/home/user/myrepo");
});

test("input matches nothing throws with status 400 and gate message", () => {
  const projects = [makeProject("/home/user/myrepo")];
  assert.throws(
    () => resolveCanvasProjectRoot("/home/user/other", projects),
    (err: any) => {
      assert.equal(err.status, 400);
      assert.equal(err.message, GATE_MSG);
      return true;
    },
  );
});

test("empty project list throws with status 400", () => {
  assert.throws(
    () => resolveCanvasProjectRoot("/home/user/myrepo", []),
    (err: any) => {
      assert.equal(err.status, 400);
      return true;
    },
  );
});

test("input matches multiple projects — first match wins", () => {
  // Duplicate paths shouldn't happen in practice but the resolver picks the
  // first one it encounters, which is deterministic and documentable.
  const projects = [
    makeProject("/home/user/shared"),
    makeProject("/home/user/shared"),
  ];
  const result = resolveCanvasProjectRoot("/home/user/shared", projects);
  assert.equal(result, "/home/user/shared");
});

test("worktree trailing slash still resolves to project root", () => {
  const projects = [
    makeProject("/home/user/myrepo", ["/home/user/myrepo/.worktrees/feat"]),
  ];
  const result = resolveCanvasProjectRoot(
    "/home/user/myrepo/.worktrees/feat/",
    projects,
  );
  assert.equal(result, "/home/user/myrepo");
});

test("uses path.resolve on both sides — relative input works if it resolves to project path", () => {
  const cwd = process.cwd();
  const projects = [makeProject(cwd)];
  // "." resolves to process.cwd()
  const result = resolveCanvasProjectRoot(".", projects);
  assert.equal(result, cwd);
});
