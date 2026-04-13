import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Role registry loader.
 *
 * A role is an *agent invocation profile*: an ordered list of CLI/model
 * choices Hydra should use to do the role's job, plus optional
 * frontmatter-driven structured guidance and a markdown briefing body.
 *
 * Why `terminals: []` is an array, not a single field:
 *   - Different roles want different SOTA model + reasoning combinations
 *     (e.g. dev = Opus max, reviewer = GPT-5 xhigh).
 *   - Order expresses preference. dispatch picks `terminals[0]`
 *     today; future fallback logic can walk the array if the first CLI
 *     is unavailable. Project- and user-level role files can override
 *     the order without forking the schema.
 *
 * Resolution order (first hit wins):
 *   1. project   → <repoPath>/.hydra/roles/<name>.md
 *   2. user      → ~/.hydra/roles/<name>.md
 *   3. builtin   → shipped with hydra (src/roles/builtin or dist/roles/builtin)
 */

export type RoleCli = "claude" | "codex";
export type RoleSource = "project" | "user" | "builtin";

/**
 * One terminal option for a role. The `cli` field selects which CLI
 * adapter (and therefore which agent_type) Hydra dispatches into. The
 * model + reasoning_effort fields are passed to that CLI's adapter at
 * launch time and ultimately become CLI arguments — `--effort <level>`
 * for claude, `-c model_reasoning_effort=<level>` for codex.
 */
export interface RoleTerminal {
  cli: RoleCli;
  /** Model name passed to the CLI's --model flag. Optional. */
  model?: string;
  /**
   * Per-CLI reasoning effort level. Use the CLI's native vocabulary —
   * claude accepts `low|medium|high|max`, codex accepts `low|medium|
   * high|xhigh`. Hydra does not normalize between them; the schema is
   * deliberately leaky so role authors can use the value each CLI
   * actually understands.
   */
  reasoning_effort?: string;
}

export interface RoleDefinition {
  name: string;
  description: string;
  /** Ordered preference list. terminals[0] is the dispatcher's choice. */
  terminals: RoleTerminal[];
  body: string;
  source: RoleSource;
  file_path: string;
}

const REQUIRED_SCALAR_FIELDS = ["name", "description"] as const;
const VALID_CLIS = new Set<RoleCli>(["claude", "codex"]);
const KNOWN_STRING_ARRAY_FIELDS = new Set<string>();
const KNOWN_OBJECT_ARRAY_FIELDS = new Set(["terminals"]);

export class RoleLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleLoadError";
  }
}

function getBuiltinSearchDirs(): string[] {
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
  stringArrays: Record<string, string[]>;
  objectArrays: Record<string, Array<Record<string, string>>>;
}

/**
 * Hand-rolled frontmatter parser tailored to role files. Supports:
 *   - scalar:           `key: value`
 *   - string array:     `key:` followed by `  - item`
 *   - object array:     `key:` followed by `  - subkey: subval` and
 *                       further `    subkey: subval` lines per object
 *
 * No nested objects beyond two levels (good enough for `terminals`),
 * no flow style, no multiline scalars. Custom on purpose to keep
 * hydra zero-runtime-deps.
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
  const stringArrays: Record<string, string[]> = {};
  const objectArrays: Record<string, Array<Record<string, string>>> = {};
  const lines = fmText.split(/\r?\n/);

  // Parser state — we track which array we're currently building and, if
  // it's an object array, which item within that array is the current one.
  let currentArrayKey: string | null = null;
  let currentArrayKind: "string" | "object" | null = null;
  let currentObject: Record<string, string> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = raw.length - raw.trimStart().length;

    // Top-level key: starts a new field. Resets array state.
    if (indent === 0) {
      const kvMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
      if (!kvMatch) {
        throw new RoleLoadError(
          `${sourceFile}: cannot parse top-level frontmatter line ${i + 1}: ${JSON.stringify(raw)}`,
        );
      }
      const [, key, rawValue] = kvMatch;
      const value = rawValue.trim();
      currentObject = null;

      if (value === "") {
        // Could be string array or object array — determine from the next non-empty line.
        currentArrayKey = key;
        currentArrayKind = peekArrayKind(lines, i);
        if (currentArrayKind === "object") {
          objectArrays[key] = [];
        } else {
          stringArrays[key] = [];
        }
      } else {
        scalars[key] = stripQuotes(value);
        currentArrayKey = null;
        currentArrayKind = null;
      }
      continue;
    }

    // Indented line — must belong to the current array.
    if (!currentArrayKey || !currentArrayKind) {
      throw new RoleLoadError(
        `${sourceFile}: indented line ${i + 1} has no parent key: ${JSON.stringify(raw)}`,
      );
    }

    const itemMatch = /^\s+-\s*(.*)$/.exec(raw);
    if (itemMatch) {
      const itemBody = itemMatch[1].trim();
      // Object-array item: starts with `key: value` after the dash.
      const subKvMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(itemBody);
      if (currentArrayKind === "object" && subKvMatch) {
        const [, subKey, subValue] = subKvMatch;
        currentObject = { [subKey]: stripQuotes(subValue.trim()) };
        objectArrays[currentArrayKey].push(currentObject);
      } else if (currentArrayKind === "string") {
        stringArrays[currentArrayKey].push(stripQuotes(itemBody));
      } else {
        throw new RoleLoadError(
          `${sourceFile}: array kind mismatch at line ${i + 1} under key "${currentArrayKey}"`,
        );
      }
      continue;
    }

    // Continuation of an object-array item: `    subkey: subvalue` (no dash).
    if (currentArrayKind === "object" && currentObject) {
      const subKvMatch = /^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
      if (!subKvMatch) {
        throw new RoleLoadError(
          `${sourceFile}: cannot parse object field on line ${i + 1}: ${JSON.stringify(raw)}`,
        );
      }
      const [, subKey, subValue] = subKvMatch;
      currentObject[subKey] = stripQuotes(subValue.trim());
      continue;
    }

    throw new RoleLoadError(
      `${sourceFile}: unexpected line ${i + 1} in frontmatter: ${JSON.stringify(raw)}`,
    );
  }

  return {
    fm: { scalars, stringArrays, objectArrays },
    body: body.replace(/^\s*\n/, ""),
  };
}

/** Peek ahead from a `key:` line to determine if its array is string- or object-shaped. */
function peekArrayKind(lines: string[], fromIndex: number): "string" | "object" {
  for (let j = fromIndex + 1; j < lines.length; j++) {
    const line = lines[j];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) return "string"; // empty array (next is a top-level key)
    const dashMatch = /^\s+-\s*(.*)$/.exec(line);
    if (!dashMatch) return "string"; // shouldn't happen, fall back
    const itemBody = dashMatch[1].trim();
    return /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(itemBody) ? "object" : "string";
  }
  return "string"; // empty array at end of frontmatter
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
 *   - missing required scalar fields (name, description)
 *   - missing or empty `terminals` array
 *   - invalid `cli` value in any terminal entry
 *   - frontmatter `name` mismatch with file basename
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

  // Validate string-array keys.
  for (const arrKey of Object.keys(fm.stringArrays)) {
    if (!KNOWN_STRING_ARRAY_FIELDS.has(arrKey)) {
      throw new RoleLoadError(
        `${resolved.filePath}: unknown string-array field "${arrKey}" (allowed: ${Array.from(
          KNOWN_STRING_ARRAY_FIELDS,
        ).join(", ")})`,
      );
    }
  }

  // Validate object-array keys.
  for (const arrKey of Object.keys(fm.objectArrays)) {
    if (!KNOWN_OBJECT_ARRAY_FIELDS.has(arrKey)) {
      throw new RoleLoadError(
        `${resolved.filePath}: unknown object-array field "${arrKey}" (allowed: ${Array.from(
          KNOWN_OBJECT_ARRAY_FIELDS,
        ).join(", ")})`,
      );
    }
  }

  // terminals[] is required and must be non-empty.
  const rawTerminals = fm.objectArrays.terminals ?? [];
  if (rawTerminals.length === 0) {
    throw new RoleLoadError(
      `${resolved.filePath}: missing required frontmatter field "terminals" (an ordered list of CLI/model choices)`,
    );
  }

  const terminals: RoleTerminal[] = rawTerminals.map((entry, idx) => {
    if (!entry.cli) {
      throw new RoleLoadError(
        `${resolved.filePath}: terminals[${idx}] is missing required field "cli"`,
      );
    }
    if (!VALID_CLIS.has(entry.cli as RoleCli)) {
      throw new RoleLoadError(
        `${resolved.filePath}: terminals[${idx}].cli "${entry.cli}" must be one of: ${Array.from(VALID_CLIS).join(", ")}`,
      );
    }
    return {
      cli: entry.cli as RoleCli,
      model: entry.model,
      reasoning_effort: entry.reasoning_effort,
    };
  });

  return {
    name: declaredName,
    description: fm.scalars.description,
    terminals,
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
