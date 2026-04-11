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

test("loadRole resolves a builtin role with a populated terminals array", () => {
  const repoPath = makeTmpRepo();
  try {
    const role = loadRole("dev", repoPath);
    assert.equal(role.name, "dev");
    assert.equal(role.source, "builtin");
    assert.ok(role.description.length > 0);
    assert.ok(role.terminals.length >= 1);
    // First terminal must declare a cli; everything else is optional.
    assert.ok(role.terminals[0].cli === "claude" || role.terminals[0].cli === "codex");
    assert.ok(role.body.length > 0);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("loadRole prefers a project-level role over the builtin with the same name", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "dev",
      [
        "---",
        "name: dev",
        "description: PROJECT OVERRIDE",
        "terminals:",
        "  - cli: codex",
        "    model: gpt-5.4",
        "    reasoning_effort: xhigh",
        "---",
        "",
        "Project body.",
      ].join("\n"),
    );
    const role = loadRole("dev", repoPath);
    assert.equal(role.source, "project");
    assert.equal(role.description, "PROJECT OVERRIDE");
    assert.equal(role.terminals.length, 1);
    assert.equal(role.terminals[0].cli, "codex");
    assert.equal(role.terminals[0].model, "gpt-5.4");
    assert.equal(role.terminals[0].reasoning_effort, "xhigh");
    assert.equal(role.body.trim(), "Project body.");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("loadRole parses a multi-entry terminals array preserving order", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "multi-cli",
      [
        "---",
        "name: multi-cli",
        "description: ordered preference list",
        "terminals:",
        "  - cli: claude",
        "    model: claude-opus-4-6",
        "    reasoning_effort: max",
        "  - cli: codex",
        "    model: gpt-5.4",
        "    reasoning_effort: xhigh",
        "---",
        "",
        "body",
      ].join("\n"),
    );
    const role = loadRole("multi-cli", repoPath);
    assert.equal(role.terminals.length, 2);
    assert.deepEqual(role.terminals[0], {
      cli: "claude",
      model: "claude-opus-4-6",
      reasoning_effort: "max",
    });
    assert.deepEqual(role.terminals[1], {
      cli: "codex",
      model: "gpt-5.4",
      reasoning_effort: "xhigh",
    });
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

test("loadRole fails fast when description is missing", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "broken-role",
      [
        "---",
        "name: broken-role",
        "terminals:",
        "  - cli: claude",
        "---",
        "",
        "body",
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

test("loadRole fails fast when terminals is missing or empty", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "no-terminals",
      [
        "---",
        "name: no-terminals",
        "description: missing terminals",
        "---",
        "",
        "body",
      ].join("\n"),
    );
    assert.throws(
      () => loadRole("no-terminals", repoPath),
      (err) => err instanceof RoleLoadError && /terminals/.test(err.message),
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("loadRole rejects an unknown cli inside terminals", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "weird-cli",
      [
        "---",
        "name: weird-cli",
        "description: bogus cli",
        "terminals:",
        "  - cli: smolagent",
        "---",
        "",
        "body",
      ].join("\n"),
    );
    assert.throws(
      () => loadRole("weird-cli", repoPath),
      (err) => err instanceof RoleLoadError && /cli/.test(err.message),
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
        "terminals:",
        "  - cli: claude",
        "---",
        "",
        "body",
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

test("loadRole parses decision_rules and acceptance_criteria as string arrays alongside terminals", () => {
  const repoPath = makeTmpRepo();
  try {
    writeProjectRole(
      repoPath,
      "with-rules",
      [
        "---",
        "name: with-rules",
        "description: array parsing test",
        "terminals:",
        "  - cli: codex",
        "    model: gpt-5.4",
        "decision_rules:",
        "  - rule one",
        "  - rule two",
        "acceptance_criteria:",
        "  - criterion one",
        "---",
        "",
        "body",
      ].join("\n"),
    );
    const role = loadRole("with-rules", repoPath);
    assert.deepEqual(role.decision_rules, ["rule one", "rule two"]);
    assert.deepEqual(role.acceptance_criteria, ["criterion one"]);
    assert.equal(role.terminals.length, 1);
    assert.equal(role.terminals[0].cli, "codex");
    assert.equal(role.terminals[0].model, "gpt-5.4");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("listRoles enumerates all builtin roles and applies project precedence", () => {
  const repoPath = makeTmpRepo();
  try {
    const before = listRoles(repoPath);
    const builtinNames = before.map((role) => role.name).sort();
    // Builtin lineup after the Lead/Dev/Reviewer formalization:
    // lead is a first-class role file even though it is never dispatched.
    assert.ok(builtinNames.includes("dev"));
    assert.ok(builtinNames.includes("lead"));
    assert.ok(builtinNames.includes("reviewer"));

    writeProjectRole(
      repoPath,
      "dev",
      [
        "---",
        "name: dev",
        "description: project version",
        "terminals:",
        "  - cli: claude",
        "---",
        "",
        "project body",
      ].join("\n"),
    );

    const after = listRoles(repoPath);
    const projectRole = after.find((role) => role.name === "dev");
    assert.ok(projectRole);
    assert.equal(projectRole!.source, "project");
    // No duplicates introduced by precedence walk.
    const names = after.map((role) => role.name);
    assert.equal(new Set(names).size, names.length);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
