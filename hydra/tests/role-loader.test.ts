import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listRoles, loadRole, RoleLoadError } from "../src/roles/loader.ts";

function makeTmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydra-roles-"));
}

function writeProjectRole(repoPath: string, name: string, content: string): void {
  const dir = path.join(repoPath, ".hydra", "roles");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), content, "utf-8");
}

test("loadRole resolves a builtin role with all required fields", () => {
  const repoPath = makeTmpRepo();
  try {
    const role = loadRole("claude-researcher", repoPath);
    assert.equal(role.name, "claude-researcher");
    assert.equal(role.agent_type, "claude");
    assert.equal(role.source, "builtin");
    assert.ok(role.description.length > 0);
    assert.ok(role.decision_rules.length > 0);
    assert.ok(role.acceptance_criteria.length > 0);
    assert.ok(role.body.length > 0);
    assert.ok(role.body.includes("researcher"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("loadRole prefers a project-level role over the builtin with the same name", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "claude-researcher",
      [
        "---",
        "name: claude-researcher",
        "description: PROJECT OVERRIDE",
        "agent_type: claude",
        "---",
        "",
        "Project body.",
      ].join("\n"),
    );
    const role = loadRole("claude-researcher", repoPath);
    assert.equal(role.source, "project");
    assert.equal(role.description, "PROJECT OVERRIDE");
    assert.equal(role.body.trim(), "Project body.");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("loadRole throws when the role file is missing across all 3 layers", () => {
  const repoPath = makeTmpRepo();
  try {
    assert.throws(
      () => loadRole("does-not-exist-anywhere", repoPath),
      (err) => err instanceof RoleLoadError && /not found/i.test(err.message),
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("loadRole fails fast when a required field is missing", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "broken-role",
      [
        "---",
        "name: broken-role",
        // intentionally no description, no agent_type
        "---",
        "",
        "Body.",
      ].join("\n"),
    );
    assert.throws(
      () => loadRole("broken-role", repoPath),
      (err) => err instanceof RoleLoadError && /description/.test(err.message),
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("loadRole rejects an unknown agent_type", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "weird-role",
      [
        "---",
        "name: weird-role",
        "description: bogus",
        "agent_type: smolagent",
        "---",
        "",
        "Body.",
      ].join("\n"),
    );
    assert.throws(
      () => loadRole("weird-role", repoPath),
      (err) => err instanceof RoleLoadError && /agent_type/.test(err.message),
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("loadRole enforces filename / frontmatter name match", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "filename-mismatch",
      [
        "---",
        "name: a-different-name",
        "description: test",
        "agent_type: claude",
        "---",
        "",
        "Body.",
      ].join("\n"),
    );
    assert.throws(
      () => loadRole("filename-mismatch", repoPath),
      (err) => err instanceof RoleLoadError && /does not match/.test(err.message),
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("loadRole parses decision_rules and acceptance_criteria as string arrays", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "array-role",
      [
        "---",
        "name: array-role",
        "description: array parsing test",
        "agent_type: codex",
        "decision_rules:",
        "  - rule one",
        "  - rule two",
        "acceptance_criteria:",
        "  - criterion one",
        "---",
        "",
        "Body.",
      ].join("\n"),
    );
    const role = loadRole("array-role", repoPath);
    assert.deepEqual(role.decision_rules, ["rule one", "rule two"]);
    assert.deepEqual(role.acceptance_criteria, ["criterion one"]);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("listRoles enumerates all builtin roles and applies project precedence", () => {
  const repoPath = makeTmpRepo();
  try {
    const before = listRoles(repoPath);
    const builtinNames = before.map((role) => role.name).sort();
    // We ship 8 builtin roles (claude/codex × researcher/implementer/tester/reviewer).
    assert.ok(builtinNames.includes("claude-researcher"));
    assert.ok(builtinNames.includes("codex-implementer"));

    writeProjectRole(
      repoPath,
      "claude-researcher",
      [
        "---",
        "name: claude-researcher",
        "description: project version",
        "agent_type: claude",
        "---",
        "",
        "project body",
      ].join("\n"),
    );

    const after = listRoles(repoPath);
    const projectRole = after.find((role) => role.name === "claude-researcher");
    assert.ok(projectRole);
    assert.equal(projectRole!.source, "project");
    // No duplicates introduced by precedence walk.
    const names = after.map((role) => role.name);
    assert.equal(new Set(names).size, names.length);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
