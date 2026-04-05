import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getSlashCommandNames,
  getSlashCommands,
} from "../electron/slash-commands.ts";

function writeSkill(
  rootDir: string,
  skillName: string,
  fileName: "SKILL.md" | "skill.md",
  description = `${skillName} description`,
): void {
  const skillDir = path.join(rootDir, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, fileName),
    [
      "---",
      `name: ${skillName}`,
      `description: ${description}`,
      "---",
      "",
      `# ${skillName}`,
    ].join("\n"),
    "utf-8",
  );
}

test("electron slash command discovery scans Claude and Codex skill directories", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-slash-"));
  const homeDir = path.join(tempDir, "home");
  const projectDir = path.join(tempDir, "project");

  writeSkill(path.join(homeDir, ".codex", "skills"), "challenge", "SKILL.md");
  writeSkill(path.join(homeDir, ".claude", "skills"), "investigate", "skill.md");
  writeSkill(path.join(projectDir, ".codex", "skills"), "project-codex", "SKILL.md");
  writeSkill(path.join(projectDir, ".claude", "skills"), "project-claude", "skill.md");

  const commands = getSlashCommandNames(projectDir, homeDir);

  assert.ok(commands.includes("challenge"));
  assert.ok(commands.includes("investigate"));
  assert.ok(commands.includes("project-codex"));
  assert.ok(commands.includes("project-claude"));
});

test("electron slash command discovery dedupes skills shared by Claude and Codex", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-slash-dedupe-"));
  const homeDir = path.join(tempDir, "home");

  writeSkill(path.join(homeDir, ".codex", "skills"), "challenge", "SKILL.md", "codex copy");
  writeSkill(path.join(homeDir, ".claude", "skills"), "challenge", "skill.md", "claude copy");

  const commands = getSlashCommands(undefined, homeDir)
    .filter((command) => command.name === "challenge");

  assert.equal(commands.length, 1);
});
