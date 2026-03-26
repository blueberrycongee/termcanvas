import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { init } from "../src/init.ts";

async function runInit(dir: string): Promise<string[]> {
  const logs: string[] = [];
  const originalLog = console.log;

  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  try {
    await init(dir);
  } finally {
    console.log = originalLog;
  }

  return logs;
}

test("init creates Hydra instructions in both CLAUDE.md and AGENTS.md", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-init-"));
  const logs = await runInit(dir);

  const claudeMd = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf-8");
  const agentsMd = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf-8");

  assert.match(claudeMd, /## Hydra Sub-Agent Tool/);
  assert.match(agentsMd, /## Hydra Sub-Agent Tool/);
  assert.deepEqual(logs, [
    "Created CLAUDE.md with hydra instructions",
    "Created AGENTS.md with hydra instructions",
  ]);
});

test("init updates an existing Hydra block in place and preserves adjacent content", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-init-update-"));
  const staleSection = [
    "# Project Notes",
    "",
    "## Hydra Sub-Agent Tool",
    "",
    "Old Hydra instructions.",
    "",
    "## Team Rules",
    "",
    "- Keep the repo tidy.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), staleSection, "utf-8");

  const logs = await runInit(dir);

  const claudeMd = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf-8");
  const agentsMd = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf-8");

  assert.equal(claudeMd.match(/## Hydra Sub-Agent Tool/g)?.length, 1);
  assert.match(claudeMd, /Hydra treats `result\.json` \+ `done` as the only completion evidence\./);
  assert.match(claudeMd, /Workflow patterns:/);
  assert.match(claudeMd, /hydra spawn --task/);
  assert.match(claudeMd, /Worker control:/);
  assert.match(claudeMd, /hydra list --repo \./);
  assert.match(claudeMd, /## Team Rules/);
  assert.match(agentsMd, /## Hydra Sub-Agent Tool/);
  assert.deepEqual(logs, [
    "Updated hydra instructions in CLAUDE.md",
    "Created AGENTS.md with hydra instructions",
  ]);
});

test("init is idempotent when the current Hydra block is already present", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-init-idempotent-"));

  await runInit(dir);
  const logs = await runInit(dir);

  assert.deepEqual(logs, [
    "CLAUDE.md already contains current hydra instructions",
    "AGENTS.md already contains current hydra instructions",
  ]);
});
