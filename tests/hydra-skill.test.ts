import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getHydraSkillLinks,
  installHydraSkillLinks,
  uninstallHydraSkillLinks,
} from "../electron/hydra-skill.ts";

test("getHydraSkillLinks includes both Claude and Codex skill directories", () => {
  assert.deepEqual(getHydraSkillLinks("/tmp/home"), [
    "/tmp/home/.claude/skills/hydra",
    "/tmp/home/.codex/skills/hydra",
  ]);
});

test("installHydraSkillLinks installs Hydra into both skill directories", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-skill-links-"));
  const home = path.join(dir, "home");
  const sourceDir = path.join(dir, "source");

  fs.mkdirSync(sourceDir, { recursive: true });
  assert.equal(installHydraSkillLinks({ home, sourceDir }), true);

  for (const link of getHydraSkillLinks(home)) {
    assert.equal(fs.readlinkSync(link), sourceDir);
  }
});

test("uninstallHydraSkillLinks removes Hydra from both skill directories", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-skill-uninstall-"));
  const home = path.join(dir, "home");
  const sourceDir = path.join(dir, "source");

  fs.mkdirSync(sourceDir, { recursive: true });
  installHydraSkillLinks({ home, sourceDir });

  assert.equal(uninstallHydraSkillLinks(home), true);

  for (const link of getHydraSkillLinks(home)) {
    assert.equal(fs.existsSync(link), false);
  }
});
