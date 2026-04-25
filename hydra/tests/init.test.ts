import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkHydraInstructionsStatus, init } from "../src/init.ts";

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

  assert.match(claudeMd, /## Hydra Orchestration Toolkit/);
  assert.match(agentsMd, /## Hydra Orchestration Toolkit/);
  assert.deepEqual(logs, [
    "Created CLAUDE.md with hydra instructions",
    "Created AGENTS.md with hydra instructions",
  ]);
});

test("init updates an existing Hydra block in place and preserves adjacent content", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-init-update-"));
  // Use the legacy marker so the test also covers the legacy → current
  // marker migration path implemented in init.ts.
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

  // Legacy marker is replaced; current marker appears exactly once.
  assert.equal(claudeMd.match(/## Hydra Orchestration Toolkit/g)?.length, 1);
  assert.doesNotMatch(claudeMd, /## Hydra Sub-Agent Tool/);

  // Headline phrasing + the four design-principle bullets are present.
  assert.match(claudeMd, /`result\.json` is the only completion evidence\./);
  assert.match(claudeMd, /Why this design/);
  assert.match(claudeMd, /SWF decider pattern/);
  assert.match(claudeMd, /Parallel-first/);
  assert.match(claudeMd, /Typed result contract/);
  assert.match(claudeMd, /Lead intervention points/);

  // Workflow patterns + agent launch rule + workflow control + telemetry
  // sections survive the rewrite.
  assert.match(claudeMd, /Workflow patterns:/);
  assert.match(claudeMd, /hydra spawn --task/);
  assert.match(claudeMd, /termcanvas terminal create --prompt/);
  assert.match(claudeMd, /Do not use `termcanvas terminal input`/);
  assert.match(claudeMd, /Workflow control:/);
  assert.match(claudeMd, /Telemetry polling:/);
  assert.match(claudeMd, /termcanvas telemetry get --workbench <workbenchId> --repo \./);
  assert.match(claudeMd, /termcanvas telemetry events --terminal <terminalId> --limit 20/);

  // TermCanvas runtime tools are discoverable from project instructions
  // even though Computer Use MCP config is injected dynamically at launch.
  assert.match(claudeMd, /TermCanvas Computer Use:/);
  assert.match(claudeMd, /dynamically inject a Computer Use MCP server/);
  assert.match(claudeMd, /Do not manually start `computer-use-helper`/);

  // Slim result contract is reflected in the rendered section.
  assert.match(claudeMd, /schema_version `hydra\/result\/v0\.1`/);
  assert.match(claudeMd, /completed\/stuck\/error/);
  assert.match(claudeMd, /report_file/);

  // Surrounding (non-Hydra) content is preserved verbatim.
  assert.match(claudeMd, /## Team Rules/);
  assert.match(agentsMd, /## Hydra Orchestration Toolkit/);
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

test("init treats duplicate legacy blocks as outdated and removes them", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-init-duplicate-"));

  await runInit(dir);

  const claudePath = path.join(dir, "CLAUDE.md");
  fs.appendFileSync(
    claudePath,
    [
      "",
      "",
      "## Hydra Sub-Agent Tool",
      "",
      "Old Hydra instructions.",
      "",
    ].join("\n"),
    "utf-8",
  );

  assert.equal(checkHydraInstructionsStatus(dir), "outdated");

  const logs = await runInit(dir);
  const claudeMd = fs.readFileSync(claudePath, "utf-8");

  assert.equal(checkHydraInstructionsStatus(dir), "current");
  assert.equal(claudeMd.match(/## Hydra Orchestration Toolkit/g)?.length, 1);
  assert.doesNotMatch(claudeMd, /## Hydra Sub-Agent Tool/);
  assert.deepEqual(logs, [
    "Updated hydra instructions in CLAUDE.md",
    "AGENTS.md already contains current hydra instructions",
  ]);
});
