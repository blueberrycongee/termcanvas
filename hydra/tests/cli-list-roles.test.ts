import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliListRoles } from "../src/cli-commands.ts";

interface CapturedConsole {
  output: string;
  restore: () => void;
}

function captureStdout(): CapturedConsole {
  const original = console.log;
  let buffer = "";
  console.log = (...args: unknown[]) => {
    buffer += args.map((arg) => String(arg)).join(" ") + "\n";
  };
  return {
    get output() {
      return buffer;
    },
    restore: () => {
      console.log = original;
    },
  };
}

function makeTmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydra-list-roles-"));
}

test("hydra list-roles outputs JSON containing all builtin roles", async () => {
  const repo = makeTmpRepo();
  const cap = captureStdout();
  try {
    await cliListRoles(["--repo", repo]);
    const parsed = JSON.parse(cap.output) as Array<{
      name: string;
      agent_type: string;
      description: string;
      source: string;
    }>;
    const names = parsed.map((row) => row.name);
    for (const expected of [
      "claude-researcher",
      "claude-implementer",
      "claude-tester",
      "claude-reviewer",
      "codex-researcher",
      "codex-implementer",
      "codex-tester",
      "codex-reviewer",
    ]) {
      assert.ok(names.includes(expected), `expected ${expected} in builtin roles`);
    }
    // Each row carries the metadata Lead actually consumes.
    for (const row of parsed) {
      assert.ok(row.name);
      assert.ok(row.agent_type);
      assert.ok(row.description);
      assert.ok(row.source);
    }
  } finally {
    cap.restore();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("hydra list-roles --agent-type codex returns only codex roles", async () => {
  const repo = makeTmpRepo();
  const cap = captureStdout();
  try {
    await cliListRoles(["--repo", repo, "--agent-type", "codex"]);
    const parsed = JSON.parse(cap.output) as Array<{ name: string; agent_type: string }>;
    assert.ok(parsed.length > 0);
    for (const row of parsed) {
      assert.equal(row.agent_type, "codex");
    }
    // Sanity-check at least one expected codex builtin made it through.
    assert.ok(parsed.some((row) => row.name === "codex-implementer"));
  } finally {
    cap.restore();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("hydra list-roles surfaces project overrides ahead of builtins in source field", async () => {
  const repo = makeTmpRepo();
  const cap = captureStdout();
  try {
    const projectDir = path.join(repo, ".hydra", "roles");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "claude-researcher.md"),
      [
        "---",
        "name: claude-researcher",
        "description: project override description",
        "agent_type: claude",
        "---",
        "",
        "Project body.",
      ].join("\n"),
      "utf-8",
    );

    await cliListRoles(["--repo", repo]);
    const parsed = JSON.parse(cap.output) as Array<{
      name: string;
      source: string;
      description: string;
    }>;
    const overridden = parsed.find((row) => row.name === "claude-researcher");
    assert.ok(overridden);
    assert.equal(overridden!.source, "project");
    assert.equal(overridden!.description, "project override description");
  } finally {
    cap.restore();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
