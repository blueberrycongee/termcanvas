import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Role registry loader.
 *
 * A role is an agent invocation profile, NOT a "subagent persona". It pins
 * one CLI (claude or codex), optionally pins a model, and supplies an
 * additive briefing block that gets prepended to task.md as a `## Role`
 * section. Hydra workers are real OS processes running the underlying CLI.
 *
 * Resolution order (first hit wins):
 *   1. project   → <repoPath>/.hydra/roles/<name>.md
 *   2. user      → ~/.hydra/roles/<name>.md
 *   3. builtin   → shipped with hydra (src/roles/builtin or dist/roles/builtin)
 */

export type RoleAgentType = "claude" | "codex";
export type RoleSource = "project" | "user" | "builtin";

export interface RoleDefinition {
  name: string;
  description: string;
  agent_type: RoleAgentType;
  model?: string;
  decision_rules: string[];
  acceptance_criteria: string[];
  body: string;
  source: RoleSource;
  file_path: string;
}

const REQUIRED_SCALAR_FIELDS = ["name", "description", "agent_type"] as const;
const VALID_AGENT_TYPES = new Set<RoleAgentType>(["claude", "codex"]);
const KNOWN_ARRAY_FIELDS = new Set(["decision_rules", "acceptance_criteria"]);

export class RoleLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleLoadError";
  }
}

function getBuiltinSearchDirs(): string[] {
  // Resolve relative to this file's location so the loader works in both
  // dev (`src/roles/loader.ts`) and bundled (`dist/hydra.js`) modes.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(here, "builtin"), // dev: src/roles/loader.ts → src/roles/builtin
    path.join(here, "roles", "builtin"), // dist: dist/hydra.js → dist/roles/builtin
  ];
}

function getProjectRoleDir(repoPath: string): string {
  return path.join(path.resolve(repoPath), ".hydra", "roles");
}

function getUserRoleDir(): string {
  return path.join(os.homedir(), ".hydra", "roles");
}

interface ResolvedRoleFile {
  filePath: string;
  source: RoleSource;
}

function resolveRoleFile(name: string, repoPath: string): ResolvedRoleFile | null {
  const projectFile = path.join(getProjectRoleDir(repoPath), `${name}.md`);
  if (fs.existsSync(projectFile)) {
    return { filePath: projectFile, source: "project" };
  }
  const userFile = path.join(getUserRoleDir(), `${name}.md`);
  if (fs.existsSync(userFile)) {
    return { filePath: userFile, source: "user" };
  }
  for (const dir of getBuiltinSearchDirs()) {
    const candidate = path.join(dir, `${name}.md`);
    if (fs.existsSync(candidate)) {
      return { filePath: candidate, source: "builtin" };
    }
  }
  return null;
}

interface ParsedFrontmatter {
  scalars: Record<string, string>;
  arrays: Record<string, string[]>;
}

/**
 * Minimal frontmatter parser tailored to role files. Supports:
 *   - scalar: `key: value` (with optional surrounding quotes)
 *   - string array: `key:` followed by `  - item` lines
 *   - blank lines and `# comment` lines (skipped)
 *
 * No nested objects, no flow style, no multiline scalars. We do this by hand
 * to avoid pulling a yaml dependency into hydra (which currently has zero
 * runtime deps).
 */
function parseFrontmatter(text: string, sourceFile: string): { fm: ParsedFrontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    throw new RoleLoadError(
      `${sourceFile}: missing or malformed frontmatter (expected leading --- block)`,
    );
  }
  const [, fmText, body] = match;

  const scalars: Record<string, string> = {};
  const arrays: Record<string, string[]> = {};
  const lines = fmText.split(/\r?\n/);

  let currentArrayKey: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const itemMatch = /^\s+-\s*(.*)$/.exec(raw);
    if (itemMatch) {
      if (!currentArrayKey) {
        throw new RoleLoadError(
          `${sourceFile}: array item on line ${i + 1} has no preceding key: ${JSON.stringify(raw)}`,
        );
      }
      arrays[currentArrayKey].push(stripQuotes(itemMatch[1].trim()));
      continue;
    }

    const kvMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
    if (!kvMatch) {
      throw new RoleLoadError(
        `${sourceFile}: cannot parse frontmatter line ${i + 1}: ${JSON.stringify(raw)}`,
      );
    }
    const [, key, rawValue] = kvMatch;
    const value = rawValue.trim();
    if (value === "") {
      currentArrayKey = key;
      arrays[key] = [];
    } else {
      scalars[key] = stripQuotes(value);
      currentArrayKey = null;
    }
  }

  return { fm: { scalars, arrays }, body: body.replace(/^\s*\n/, "") };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Load a single role by name. Throws RoleLoadError fast on:
 *   - file not found in any of the 3 search locations
 *   - malformed frontmatter
 *   - missing required scalar fields
 *   - frontmatter `name` mismatch with file basename
 *   - unknown agent_type
 */
export function loadRole(name: string, repoPath: string): RoleDefinition {
  const resolved = resolveRoleFile(name, repoPath);
  if (!resolved) {
    throw new RoleLoadError(
      `Role "${name}" not found in project (.hydra/roles), user (~/.hydra/roles), or builtin role registries.`,
    );
  }

  const text = fs.readFileSync(resolved.filePath, "utf-8");
  const { fm, body } = parseFrontmatter(text, resolved.filePath);

  for (const field of REQUIRED_SCALAR_FIELDS) {
    if (!fm.scalars[field] || fm.scalars[field].trim() === "") {
      throw new RoleLoadError(
        `${resolved.filePath}: missing required frontmatter field "${field}"`,
      );
    }
  }

  const declaredName = fm.scalars.name;
  if (declaredName !== name) {
    throw new RoleLoadError(
      `${resolved.filePath}: frontmatter name "${declaredName}" does not match file basename "${name}"`,
    );
  }

  const agentType = fm.scalars.agent_type as RoleAgentType;
  if (!VALID_AGENT_TYPES.has(agentType)) {
    throw new RoleLoadError(
      `${resolved.filePath}: agent_type "${fm.scalars.agent_type}" must be one of: ${Array.from(
        VALID_AGENT_TYPES,
      ).join(", ")}`,
    );
  }

  for (const arrKey of Object.keys(fm.arrays)) {
    if (!KNOWN_ARRAY_FIELDS.has(arrKey)) {
      throw new RoleLoadError(
        `${resolved.filePath}: unknown array field "${arrKey}" in frontmatter (allowed: ${Array.from(
          KNOWN_ARRAY_FIELDS,
        ).join(", ")})`,
      );
    }
  }

  return {
    name: declaredName,
    description: fm.scalars.description,
    agent_type: agentType,
    model: fm.scalars.model,
    decision_rules: fm.arrays.decision_rules ?? [],
    acceptance_criteria: fm.arrays.acceptance_criteria ?? [],
    body: body.trim(),
    source: resolved.source,
    file_path: resolved.filePath,
  };
}

/**
 * Enumerate all available roles across all 3 search locations, with project
 * > user > builtin precedence applied per name. Errors during load are
 * propagated — listings are infrequent and we want bad builtin files to be
 * caught loudly, not silently dropped from the list.
 */
export function listRoles(repoPath: string): RoleDefinition[] {
  const dirs = [getProjectRoleDir(repoPath), getUserRoleDir(), ...getBuiltinSearchDirs()];
  const names = new Set<string>();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(".md")) names.add(entry.slice(0, -3));
    }
  }

  const roles = Array.from(names).map((name) => loadRole(name, repoPath));
  return roles.sort((a, b) => a.name.localeCompare(b.name));
}
