import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureSkillLinks,
  installSkillLinks,
  uninstallSkillLinks,
} from "../electron/skill-manager.ts";

function makeTempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-mgr-"));
  const home = path.join(dir, "home");
  const sourceDir = path.join(dir, "source");
  const skillsRoot = path.join(sourceDir, "skills");

  // Create fake bundled skills including hydra
  for (const name of ["hydra", "code-review", "qa"]) {
    const skillDir = path.join(skillsRoot, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${name}`);
  }

  // Create scripts dir for hook registration
  const scriptsDir = path.join(sourceDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, "memory-session-start.sh"), "#!/bin/bash\n");

  return { dir, home, sourceDir };
}

function getSkillLink(home: string, provider: string, name: string): string {
  return path.join(home, `.${provider}`, "skills", name);
}

test("installSkillLinks creates symlinks for all skills including hydra", () => {
  const { home, sourceDir } = makeTempEnv();

  assert.equal(installSkillLinks({ home, sourceDir }), true);

  for (const name of ["hydra", "code-review", "qa"]) {
    const claude = getSkillLink(home, "claude", name);
    const codex = getSkillLink(home, "codex", name);
    assert.equal(fs.existsSync(claude), true, `${name} missing in .claude/skills`);
    assert.equal(fs.existsSync(codex), true, `${name} missing in .codex/skills`);
    assert.equal(
      fs.readlinkSync(claude),
      path.join(sourceDir, "skills", name),
    );
  }
});

test("ensureSkillLinks preserves hydra symlink across repeated calls", () => {
  const { home, sourceDir } = makeTempEnv();

  installSkillLinks({ home, sourceDir });
  const hydraLink = getSkillLink(home, "claude", "hydra");
  assert.equal(fs.existsSync(hydraLink), true);

  // Call ensure multiple times — hydra must survive
  ensureSkillLinks({ home, sourceDir });
  ensureSkillLinks({ home, sourceDir });
  assert.equal(fs.existsSync(hydraLink), true, "hydra symlink deleted by ensureSkillLinks");
  assert.equal(
    fs.readlinkSync(hydraLink),
    path.join(sourceDir, "skills", "hydra"),
  );
});

test("ensureSkillLinks updates stale symlinks", () => {
  const { home, sourceDir } = makeTempEnv();

  installSkillLinks({ home, sourceDir });

  // Replace hydra symlink with a stale one
  const hydraLink = getSkillLink(home, "claude", "hydra");
  fs.unlinkSync(hydraLink);
  fs.symlinkSync("/tmp/stale-target", hydraLink, "dir");

  ensureSkillLinks({ home, sourceDir });
  assert.equal(
    fs.readlinkSync(hydraLink),
    path.join(sourceDir, "skills", "hydra"),
  );
});

test("uninstallSkillLinks removes all symlinks", () => {
  const { home, sourceDir } = makeTempEnv();

  installSkillLinks({ home, sourceDir });
  uninstallSkillLinks({ home, sourceDir });

  for (const name of ["hydra", "code-review", "qa"]) {
    assert.equal(
      fs.existsSync(getSkillLink(home, "claude", name)),
      false,
      `${name} not removed from .claude/skills`,
    );
    assert.equal(
      fs.existsSync(getSkillLink(home, "codex", name)),
      false,
      `${name} not removed from .codex/skills`,
    );
  }
});
