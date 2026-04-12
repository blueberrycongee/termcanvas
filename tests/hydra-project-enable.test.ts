import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkHydraProjectStatus,
  enableHydraForProject,
} from "../electron/hydra-project.ts";

test("enableHydraForProject writes Hydra instructions into the project root", () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "termcanvas-hydra-enable-"));

  const result = enableHydraForProject(repoPath);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.changed, true);
  assert.match(fs.readFileSync(path.join(repoPath, "CLAUDE.md"), "utf-8"), /## Hydra Orchestration Toolkit/);
  assert.match(fs.readFileSync(path.join(repoPath, "AGENTS.md"), "utf-8"), /## Hydra Orchestration Toolkit/);
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
  assert.deepEqual(second.files.map((file) => file.status), ["unchanged", "unchanged"]);
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
