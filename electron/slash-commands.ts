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
      const skillFile = join(dirPath, entry.name, "skill.md");
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
    // Directory unreadable
  }
  return commands;
}

// Built-in Claude Code slash commands (always available)
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

export function getSlashCommands(projectCwd?: string): SlashCommand[] {
  const globalSkillDir = join(homedir(), ".claude", "skills");
  const commands = [...BUILTIN_COMMANDS];
  const seen = new Set(commands.map((c) => c.name));

  // Global user skills
  for (const cmd of scanSkillDir(globalSkillDir)) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      commands.push(cmd);
    }
  }

  // Project-level skills
  if (projectCwd) {
    const projectSkillDir = join(projectCwd, ".claude", "skills");
    for (const cmd of scanSkillDir(projectSkillDir)) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        commands.push(cmd);
      }
    }
  }

  // Plugin skills (scan plugin directories)
  const pluginDir = join(homedir(), ".claude", "plugins", "marketplaces");
  if (existsSync(pluginDir)) {
    try {
      for (const marketplace of readdirSync(pluginDir, { withFileTypes: true })) {
        if (!marketplace.isDirectory()) continue;
        const mDir = join(pluginDir, marketplace.name);
        // Plugins can have skills in subdirectories
        for (const cmd of scanSkillDir(join(mDir, "skills"))) {
          if (!seen.has(cmd.name)) {
            seen.add(cmd.name);
            commands.push(cmd);
          }
        }
        // Some plugins have skills directly with skill.md
        for (const cmd of scanSkillDir(mDir)) {
          const prefixed = `${marketplace.name}:${cmd.name}`;
          if (!seen.has(prefixed) && !seen.has(cmd.name)) {
            seen.add(prefixed);
            commands.push({ ...cmd, name: prefixed });
          }
        }
      }
    } catch {
      // Plugin dir unreadable
    }
  }

  return commands;
}

export function getSlashCommandNames(projectCwd?: string): string[] {
  return getSlashCommands(projectCwd).map((c) => c.name);
}
