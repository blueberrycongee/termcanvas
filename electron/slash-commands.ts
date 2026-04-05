/**
 * Scan skill directories to build slash command list without spawning Claude Code.
 * Mirrors Claude Code's getSkillDirCommands() logic but runs synchronously.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface SlashCommand {
  name: string;
  description: string;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

function scanSkillDir(dirPath: string): SlashCommand[] {
  if (!existsSync(dirPath)) return [];
  const commands: SlashCommand[] = [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = resolveSkillFile(dirPath, entry.name);
      if (!existsSync(skillFile)) continue;
      try {
        const content = readFileSync(skillFile, "utf-8");
        const { name, description } = parseSkillFrontmatter(content);
        commands.push({
          name: name ?? entry.name,
          description: description ?? "",
        });
      } catch {
        commands.push({ name: entry.name, description: "" });
      }
    }
  } catch {
  }
  return commands;
}

function resolveSkillFile(dirPath: string, skillName: string): string {
  for (const fileName of ["SKILL.md", "skill.md"]) {
    const candidate = join(dirPath, skillName, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return join(dirPath, skillName, "SKILL.md");
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "compact", description: "Compact conversation context" },
  { name: "cost", description: "Show token usage and cost" },
  { name: "context", description: "Show context window usage" },
  { name: "init", description: "Initialize project CLAUDE.md" },
  { name: "review", description: "Review code changes" },
  { name: "pr-comments", description: "Address PR review comments" },
  { name: "release-notes", description: "Generate release notes" },
  { name: "security-review", description: "Security review of changes" },
  { name: "help", description: "Show help" },
];

function appendCommands(
  commands: SlashCommand[],
  seen: Set<string>,
  nextCommands: SlashCommand[],
): void {
  for (const cmd of nextCommands) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      commands.push(cmd);
    }
  }
}

function skillRoots(homeDir: string, projectCwd?: string): string[] {
  const roots = [
    join(homeDir, ".claude", "skills"),
    join(homeDir, ".codex", "skills"),
  ];

  if (projectCwd) {
    roots.push(
      join(projectCwd, ".claude", "skills"),
      join(projectCwd, ".codex", "skills"),
    );
  }

  return roots;
}

export function getSlashCommands(projectCwd?: string, homeDir = homedir()): SlashCommand[] {
  const commands = [...BUILTIN_COMMANDS];
  const seen = new Set(commands.map((c) => c.name));

  for (const dirPath of skillRoots(homeDir, projectCwd)) {
    appendCommands(commands, seen, scanSkillDir(dirPath));
  }

  const pluginDir = join(homeDir, ".claude", "plugins", "marketplaces");
  if (existsSync(pluginDir)) {
    try {
      for (const marketplace of readdirSync(pluginDir, { withFileTypes: true })) {
        if (!marketplace.isDirectory()) continue;
        const mDir = join(pluginDir, marketplace.name);
        appendCommands(commands, seen, scanSkillDir(join(mDir, "skills")));
        for (const cmd of scanSkillDir(mDir)) {
          const prefixed = `${marketplace.name}:${cmd.name}`;
          if (!seen.has(prefixed) && !seen.has(cmd.name)) {
            seen.add(prefixed);
            commands.push({ ...cmd, name: prefixed });
          }
        }
      }
    } catch {
    }
  }

  return commands;
}

export function getSlashCommandNames(projectCwd?: string, homeDir = homedir()): string[] {
  return getSlashCommands(projectCwd, homeDir).map((c) => c.name);
}
