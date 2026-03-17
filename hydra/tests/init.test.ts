import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { init } from "../src/init.ts";

const MARKER = "## Hydra Sub-Agent Tool";

test("init creates Hydra instructions in both CLAUDE.md and AGENTS.md", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-init-"));
  const prevCwd = process.cwd();
  const logs: string[] = [];
  const originalLog = console.log;

  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  process.chdir(dir);

  try {
    await init();
  } finally {
    process.chdir(prevCwd);
    console.log = originalLog;
  }

  const claudeMd = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf-8");
  const agentsMd = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf-8");

  assert.match(claudeMd, /## Hydra Sub-Agent Tool/);
  assert.match(agentsMd, /## Hydra Sub-Agent Tool/);
  assert.deepEqual(logs, [
    "Created CLAUDE.md with hydra instructions",
    "Created AGENTS.md with hydra instructions",
  ]);
});

test("init skips files that already contain the Hydra section and still updates the missing one", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-init-existing-"));
  const prevCwd = process.cwd();
  const logs: string[] = [];
  const originalLog = console.log;

  fs.writeFileSync(path.join(dir, "CLAUDE.md"), `${MARKER}\n`);
  console.log = (...args) => {
    logs.push(args.join(" "));
  };
  process.chdir(dir);

  try {
    await init();
  } finally {
    process.chdir(prevCwd);
    console.log = originalLog;
  }

  const claudeMd = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf-8");
  const agentsMd = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf-8");

  assert.equal(claudeMd.match(/## Hydra Sub-Agent Tool/g)?.length, 1);
  assert.match(agentsMd, /## Hydra Sub-Agent Tool/);
  assert.deepEqual(logs, [
    "CLAUDE.md already contains hydra instructions — skipping.",
    "Created AGENTS.md with hydra instructions",
  ]);
});
