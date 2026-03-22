import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureHydraSkillLinks,
  getHydraSkillLinks,
  getHydraSkillLinkType,
  installHydraSkillLinks,
  uninstallHydraSkillLinks,
} from "../electron/hydra-skill.ts";

test("getHydraSkillLinks includes both Claude and Codex skill directories", () => {
  assert.deepEqual(getHydraSkillLinks("/tmp/home"), [
    path.join("/tmp/home", ".claude", "skills", "hydra"),
    path.join("/tmp/home", ".codex", "skills", "hydra"),
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

test("ensureHydraSkillLinks creates missing links and updates stale targets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-skill-ensure-"));
  const home = path.join(dir, "home");
  const staleSourceDir = path.join(dir, "stale-source");
  const currentSourceDir = path.join(dir, "current-source");

  fs.mkdirSync(staleSourceDir, { recursive: true });
  fs.mkdirSync(currentSourceDir, { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "skills"), { recursive: true });
  fs.symlinkSync(
    staleSourceDir,
    path.join(home, ".claude", "skills", "hydra"),
    getHydraSkillLinkType(),
  );

  assert.equal(ensureHydraSkillLinks({ home, sourceDir: currentSourceDir }), true);

  for (const link of getHydraSkillLinks(home)) {
    assert.equal(fs.readlinkSync(link), currentSourceDir);
  }
});

test("ensureHydraSkillLinks is a no-op when links already point at the current source", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-skill-noop-"));
  const home = path.join(dir, "home");
  const sourceDir = path.join(dir, "source");

  fs.mkdirSync(sourceDir, { recursive: true });
  installHydraSkillLinks({ home, sourceDir });

  const beforeMtimes = getHydraSkillLinks(home).map((link) => fs.lstatSync(link).mtimeMs);
  assert.equal(ensureHydraSkillLinks({ home, sourceDir }), true);
  const afterMtimes = getHydraSkillLinks(home).map((link) => fs.lstatSync(link).mtimeMs);

  assert.deepEqual(afterMtimes, beforeMtimes);
});
