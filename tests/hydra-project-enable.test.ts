import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkHydraProjectStatus,
  enableHydraForProject,
} from "../electron/hydra-project.ts";

test("enableHydraForProject writes Hydra and Task instructions into the project root", () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-hydra-enable-"));

  const result = enableHydraForProject(repoPath);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.changed, true);
  const claude = fs.readFileSync(path.join(repoPath, "CLAUDE.md"), "utf-8");
  const agents = fs.readFileSync(path.join(repoPath, "AGENTS.md"), "utf-8");
  assert.match(claude, /## Hydra Orchestration Toolkit/);
  assert.match(agents, /## Hydra Orchestration Toolkit/);
  assert.match(claude, /## TermCanvas Task System/);
  assert.match(agents, /## TermCanvas Task System/);
});

test("enableHydraForProject reports unchanged when the current instructions already exist", () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-hydra-current-"));

  const first = enableHydraForProject(repoPath);
  assert.equal(first.ok, true);

  const second = enableHydraForProject(repoPath);

  assert.equal(second.ok, true);
  if (!second.ok) {
    return;
  }

  assert.equal(second.changed, false);
  // Two sections (Hydra + Task) × two files (CLAUDE.md, AGENTS.md) = four entries.
  assert.deepEqual(
    second.files.map((file) => file.status),
    ["unchanged", "unchanged", "unchanged", "unchanged"],
  );
});

test("checkHydraProjectStatus auto-installs the Task section for projects that already opted into Hydra", () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-task-autoadd-"));
  // Project opted into Hydra before the Task section existed: install Hydra
  // instructions cleanly, leaving no Task section anywhere.
  const first = enableHydraForProject(repoPath);
  assert.equal(first.ok, true);
  for (const fileName of ["CLAUDE.md", "AGENTS.md"]) {
    const filePath = path.join(repoPath, fileName);
    const stripped = fs.readFileSync(filePath, "utf-8").replace(
      /\n## TermCanvas Task System[\s\S]*$/,
      "\n",
    );
    fs.writeFileSync(filePath, stripped, "utf-8");
    assert.doesNotMatch(stripped, /## TermCanvas Task System/);
  }

  const status = checkHydraProjectStatus(repoPath);

  assert.equal(status, "current");
  assert.match(
    fs.readFileSync(path.join(repoPath, "CLAUDE.md"), "utf-8"),
    /## TermCanvas Task System/,
  );
  assert.match(
    fs.readFileSync(path.join(repoPath, "AGENTS.md"), "utf-8"),
    /## TermCanvas Task System/,
  );
});

test("enableHydraForProject rejects missing project paths", () => {
  const result = enableHydraForProject("/tmp/termcanvas-missing-hydra-project");

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.match(result.error, /no such file or directory/i);
});

test("checkHydraProjectStatus auto-upgrades outdated Hydra instructions for old projects", () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-hydra-upgrade-"));
  const legacy = [
    "# Notes",
    "",
    "## Hydra Sub-Agent Tool",
    "",
    "Old Hydra instructions.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(repoPath, "CLAUDE.md"), legacy, "utf-8");
  fs.writeFileSync(path.join(repoPath, "AGENTS.md"), legacy, "utf-8");

  const status = checkHydraProjectStatus(repoPath);

  assert.equal(status, "current");
  const claudeMd = fs.readFileSync(path.join(repoPath, "CLAUDE.md"), "utf-8");
  const agentsMd = fs.readFileSync(path.join(repoPath, "AGENTS.md"), "utf-8");
  assert.match(claudeMd, /## Hydra Orchestration Toolkit/);
  assert.match(agentsMd, /## Hydra Orchestration Toolkit/);
  assert.doesNotMatch(claudeMd, /## Hydra Sub-Agent Tool/);
  assert.doesNotMatch(agentsMd, /## Hydra Sub-Agent Tool/);
});
