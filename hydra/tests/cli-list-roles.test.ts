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

test("hydra list-roles outputs JSON containing all 3 builtin roles", async () => {
  const repo = makeTmpRepo();
  const cap = captureStdout();
  try {
    await cliListRoles(["--repo", repo]);
    const parsed = JSON.parse(cap.output) as Array<{
      name: string;
      description: string;
      terminals: Array<{ cli: string; model?: string; reasoning_effort?: string }>;
      source: string;
    }>;
    const names = parsed.map((row) => row.name).sort();
    // Builtin lineup after the Lead/Dev/Reviewer formalization.
    assert.deepEqual(names, ["dev", "lead", "reviewer"]);

    // Each row carries the metadata Lead actually consumes.
    for (const row of parsed) {
      assert.ok(row.name);
      assert.ok(row.description);
      assert.ok(row.source);
      assert.ok(row.terminals.length >= 1);
      assert.ok(row.terminals[0].cli === "claude" || row.terminals[0].cli === "codex");
    }
  } finally {
    cap.restore();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("hydra list-roles --cli codex returns roles whose primary terminal targets codex", async () => {
  const repo = makeTmpRepo();
  const cap = captureStdout();
  try {
    await cliListRoles(["--repo", repo, "--cli", "codex"]);
    const parsed = JSON.parse(cap.output) as Array<{
      name: string;
      terminals: Array<{ cli: string }>;
    }>;
    assert.ok(parsed.length > 0);
    for (const row of parsed) {
      assert.equal(row.terminals[0].cli, "codex");
    }
    // reviewer is the only codex-primary role in the post-rename lineup.
    // dev and lead both default to claude for terminals[0].
    const names = parsed.map((row) => row.name).sort();
    assert.deepEqual(names, ["reviewer"]);
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
      path.join(projectDir, "dev.md"),
      [
        "---",
        "name: dev",
        "description: project override description",
        "terminals:",
        "  - cli: claude",
        "    model: claude-opus-4-6",
        "    reasoning_effort: max",
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
      terminals: Array<{ cli: string; model?: string; reasoning_effort?: string }>;
    }>;
    const overridden = parsed.find((row) => row.name === "dev");
    assert.ok(overridden);
    assert.equal(overridden!.source, "project");
    assert.equal(overridden!.description, "project override description");
    assert.deepEqual(overridden!.terminals, [
      { cli: "claude", model: "claude-opus-4-6", reasoning_effort: "max" },
    ]);
  } finally {
    cap.restore();
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
