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

const MANIFEST_FILE = ".termcanvas-skills.json";

function makeTempEnv(skillNames = ["hydra", "code-review", "qa"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-mgr-"));
  const home = path.join(dir, "home");
  const sourceDir = path.join(dir, "source");

  for (const name of skillNames) {
    const skillDir = path.join(sourceDir, "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${name}`);
  }

  const scriptsDir = path.join(sourceDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "memory-session-start.sh"),
    "#!/bin/bash\n",
  );
  fs.writeFileSync(path.join(scriptsDir, "termcanvas-hook.mjs"), "// hook\n");

  return { dir, home, sourceDir };
}

function link(home: string, provider: string, name: string): string {
  return path.join(home, `.${provider}`, "skills", name);
}

function readManifest(home: string, provider: string) {
  const p = path.join(home, `.${provider}`, "skills", MANIFEST_FILE);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

test("installSkillLinks creates symlinks for all skills including hydra", () => {
  const { home, sourceDir } = makeTempEnv();
  assert.equal(
    installSkillLinks({ home, sourceDir, appVersion: "0.18.0" }),
    true,
  );

  for (const name of ["hydra", "code-review", "qa"]) {
    const claude = link(home, "claude", name);
    const codex = link(home, "codex", name);
    assert.equal(
      fs.existsSync(claude),
      true,
      `${name} missing in .claude/skills`,
    );
    assert.equal(
      fs.existsSync(codex),
      true,
      `${name} missing in .codex/skills`,
    );
    assert.equal(fs.readlinkSync(claude), path.join(sourceDir, "skills", name));
  }
});

test("uninstallSkillLinks removes all symlinks and manifest", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });
  uninstallSkillLinks({ home, sourceDir });

  for (const name of ["hydra", "code-review", "qa"]) {
    assert.equal(fs.existsSync(link(home, "claude", name)), false);
    assert.equal(fs.existsSync(link(home, "codex", name)), false);
  }
  assert.equal(readManifest(home, "claude"), null);
  assert.equal(readManifest(home, "codex"), null);
});

test("installSkillLinks writes manifest with version and skill list", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const m = readManifest(home, "claude");
  assert.equal(m.version, "0.18.0");
  assert.deepEqual(m.skills.sort(), ["code-review", "hydra", "qa"]);
});

test("ensureSkillLinks preserves hydra symlink across repeated calls", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  ensureSkillLinks({ home, sourceDir, appVersion: "0.18.0" });
  ensureSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const hydra = link(home, "claude", "hydra");
  assert.equal(
    fs.existsSync(hydra),
    true,
    "hydra symlink deleted by ensureSkillLinks",
  );
  assert.equal(fs.readlinkSync(hydra), path.join(sourceDir, "skills", "hydra"));
});

test("ensureSkillLinks fast path: skips work when version matches", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const before = fs.lstatSync(link(home, "claude", "hydra")).mtimeMs;
  ensureSkillLinks({ home, sourceDir, appVersion: "0.18.0" });
  const after = fs.lstatSync(link(home, "claude", "hydra")).mtimeMs;

  assert.equal(after, before, "symlink was recreated despite version match");
});

test("ensureSkillLinks repairs deleted symlink even when version matches", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  fs.unlinkSync(link(home, "claude", "hydra"));
  ensureSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  assert.equal(fs.existsSync(link(home, "claude", "hydra")), true);
});

test("ensureSkillLinks updates stale symlinks", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const hydra = link(home, "claude", "hydra");
  fs.unlinkSync(hydra);
  fs.symlinkSync("/tmp/stale-target", hydra, "dir");

  ensureSkillLinks({ home, sourceDir, appVersion: "0.19.0" });
  assert.equal(fs.readlinkSync(hydra), path.join(sourceDir, "skills", "hydra"));
});

test("version upgrade removes skills dropped from bundle", () => {
  const { home, sourceDir, dir } = makeTempEnv([
    "hydra",
    "code-review",
    "qa",
    "old-skill",
  ]);
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  assert.equal(fs.existsSync(link(home, "claude", "old-skill")), true);

  const newSourceDir = path.join(dir, "source-v2");
  for (const name of ["hydra", "code-review", "qa"]) {
    const skillDir = path.join(newSourceDir, "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${name}`);
  }
  const scriptsDir = path.join(newSourceDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "memory-session-start.sh"),
    "#!/bin/bash\n",
  );

  ensureSkillLinks({ home, sourceDir: newSourceDir, appVersion: "0.19.0" });

  assert.equal(
    fs.existsSync(link(home, "claude", "old-skill")),
    false,
    "stale skill not removed",
  );
  assert.equal(
    fs.existsSync(link(home, "codex", "old-skill")),
    false,
    "stale skill not removed from codex",
  );
  assert.equal(fs.existsSync(link(home, "claude", "hydra")), true);

  const m = readManifest(home, "claude");
  assert.equal(m.version, "0.19.0");
  assert.ok(!m.skills.includes("old-skill"));
});

test("version upgrade adds new skills from bundle", () => {
  const { home, sourceDir, dir } = makeTempEnv(["hydra", "code-review"]);
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const newSourceDir = path.join(dir, "source-v2");
  for (const name of ["hydra", "code-review", "new-skill"]) {
    const skillDir = path.join(newSourceDir, "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${name}`);
  }
  const scriptsDir = path.join(newSourceDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "memory-session-start.sh"),
    "#!/bin/bash\n",
  );

  ensureSkillLinks({ home, sourceDir: newSourceDir, appVersion: "0.19.0" });

  assert.equal(fs.existsSync(link(home, "claude", "new-skill")), true);
  assert.equal(fs.existsSync(link(home, "codex", "new-skill")), true);
});

test("skips non-symlink entries (user-managed directories)", () => {
  const { home, sourceDir } = makeTempEnv();

  const userDir = link(home, "claude", "hydra");
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, "custom.md"), "user content");

  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  assert.equal(
    fs.lstatSync(userDir).isDirectory(),
    true,
    "user dir was replaced",
  );
  assert.equal(fs.existsSync(path.join(userDir, "custom.md")), true);
});

test("uninstall removes skills tracked in manifest even if missing from current bundle", () => {
  const { home, sourceDir, dir } = makeTempEnv([
    "hydra",
    "code-review",
    "qa",
    "old-skill",
  ]);
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const newSourceDir = path.join(dir, "source-v2");
  for (const name of ["hydra", "code-review", "qa"]) {
    const skillDir = path.join(newSourceDir, "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
  }

  // Uninstall with new sourceDir that doesn't know about old-skill
  uninstallSkillLinks({ home, sourceDir: newSourceDir });

  assert.equal(fs.existsSync(link(home, "claude", "old-skill")), false);
  assert.equal(readManifest(home, "claude"), null);
});

test("uninstallSkillLinks removes termcanvas entries from codex hooks.json", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const hooksFile = path.join(home, ".codex", "hooks.json");
  assert.equal(fs.existsSync(hooksFile), true);

  uninstallSkillLinks({ home, sourceDir });

  // hooks.json should still exist but with no termcanvas entries
  const hooks = JSON.parse(fs.readFileSync(hooksFile, "utf-8"));
  for (const event of [
    "PreToolUse",
    "PostToolUse",
    "SessionStart",
    "Stop",
    "UserPromptSubmit",
  ]) {
    const entries = hooks.hooks?.[event] ?? [];
    for (const entry of entries) {
      for (const h of entry.hooks ?? []) {
        assert.ok(
          !h.command.includes("termcanvas-hook.mjs"),
          `${event} still has termcanvas hook after uninstall`,
        );
      }
    }
  }
});

test("installSkillLinks enables codex_hooks feature flag in config.toml", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const configFile = path.join(home, ".codex", "config.toml");
  assert.equal(fs.existsSync(configFile), true, "config.toml not created");

  const content = fs.readFileSync(configFile, "utf-8");
  assert.ok(content.includes("codex_hooks = true"), "codex_hooks flag not set");
});

test("ensureCodexFeatureFlag preserves existing config.toml content", () => {
  const { home, sourceDir } = makeTempEnv();

  const codexDir = path.join(home, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexDir, "config.toml"),
    'model = "gpt-4"\n\n[features]\napply_patch = true\n',
  );

  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const content = fs.readFileSync(path.join(codexDir, "config.toml"), "utf-8");
  assert.ok(content.includes('model = "gpt-4"'), "existing model setting lost");
  assert.ok(
    content.includes("apply_patch = true"),
    "existing feature flag lost",
  );
  assert.ok(content.includes("codex_hooks = true"), "codex_hooks not added");
});

test("installSkillLinks creates codex hooks.json with all 5 events", () => {
  const { home, sourceDir } = makeTempEnv();
  installSkillLinks({ home, sourceDir, appVersion: "0.18.0" });

  const hooksFile = path.join(home, ".codex", "hooks.json");
  assert.equal(fs.existsSync(hooksFile), true, "hooks.json not created");

  const hooks = JSON.parse(fs.readFileSync(hooksFile, "utf-8"));
  for (const event of [
    "PreToolUse",
    "PostToolUse",
    "SessionStart",
    "Stop",
    "UserPromptSubmit",
  ]) {
    assert.ok(hooks.hooks[event], `missing hook event: ${event}`);
    assert.equal(hooks.hooks[event].length, 1);
    assert.ok(
      hooks.hooks[event][0].hooks[0].command.includes("termcanvas-hook.mjs"),
      `${event} hook command missing termcanvas-hook.mjs`,
    );
  }
});
