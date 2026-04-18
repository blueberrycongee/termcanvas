/**
 * In-memory metadata index for historical agent sessions.
 *
 * Purpose: power the Cmd+K "find a past session" flow without paying
 * the cost of re-parsing JSONL on every keystroke. The index stores
 * just enough per session (first user prompt, provider, project dir,
 * recency) for the renderer to fuzzy-match titles client-side and
 * render a recognisable list. Full-content search stays opt-in and
 * scoped to a single project's session directory.
 *
 * Design notes:
 *  - One per-file cache entry, invalidated when the file's mtime
 *    changes. Listing the same project twice is O(sessions) stat
 *    calls, not O(sessions) JSONL parses.
 *  - Claude sessions live under `~/.claude/projects/<encoded-path>/`
 *    where encoded-path is the project's absolute path with `/`
 *    replaced by `-`. We map a user's real project path to that
 *    encoded dir and enumerate only that subdirectory — avoids
 *    scanning the whole Claude projects tree.
 *  - Codex sessions live in `~/.codex/sessions/**` without any
 *    project scoping in the filesystem. We read each file's
 *    `session_meta.payload.cwd` (Codex writes the real cwd into
 *    the session meta) and filter by match against the caller's
 *    project set.
 *  - Skip files > MAX_FILE_SIZE_FOR_INDEX (20 MB) — real-world
 *    JSONLs rarely exceed a few hundred KB; a 20 MB file is either
 *    corrupt or a fuzz/log-dump run and not worth indexing.
 *  - Cap readline to HEAD_LINES_FOR_PROMPT (50). First user prompt
 *    shows up in the first ~5 lines for both providers; 50 is a
 *    safety margin for weird headers or metadata-heavy sessions.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

import { findCodexJsonlFiles } from "./usage-collector.ts";

export interface SessionSearchEntry {
  sessionId: string;
  provider: "claude" | "codex";
  /**
   * Canonicalised absolute path of the project the session belongs to.
   * For Claude, reconstructed from the encoded dir name. For Codex,
   * read from `session_meta.payload.cwd`.
   */
  projectDir: string;
  filePath: string;
  firstPrompt: string;
  /** ISO, file birthtime. */
  startedAt: string;
  /** ISO, file mtime. */
  lastActivityAt: string;
  /** Rough estimate from file size; exact count would require full scan. */
  estimatedMessageCount: number;
  fileSize: number;
}

interface CacheEntry {
  entry: SessionSearchEntry;
  mtimeMs: number;
}

const fileCache = new Map<string, CacheEntry>();

const HEAD_LINES_FOR_PROMPT = 50;
const MAX_FILE_SIZE_FOR_INDEX = 20 * 1024 * 1024;
const AVG_LINE_BYTES_ESTIMATE = 500;
const FIRST_PROMPT_MAX_LENGTH = 200;

function decodeClaudeEncodedPath(encoded: string): string {
  // Claude stores projects under `-Users-foo-bar`; decode back to
  // `/Users/foo/bar`. This is a lossy encoding — a project with an
  // actual `-` in its path will round-trip to a different real
  // path. We tolerate that: the reverse mapping is used only for
  // *display*; match is done on forward encoding.
  return encoded.startsWith("-") ? `/${encoded.slice(1).replace(/-/g, "/")}` : encoded.replace(/-/g, "/");
}

function encodeProjectPathForClaude(projectDir: string): string {
  return projectDir.replace(/\//g, "-");
}

/**
 * Extract the first meaningful user prompt from a session JSONL.
 * Returns empty string if none found within HEAD_LINES_FOR_PROMPT.
 */
async function readFirstPromptAndMeta(
  filePath: string,
  provider: "claude" | "codex",
): Promise<{ firstPrompt: string; codexCwd: string | null }> {
  let firstPrompt = "";
  let codexCwd: string | null = null;
  let linesRead = 0;

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      linesRead += 1;
      if (linesRead > HEAD_LINES_FOR_PROMPT) break;
      if (!line.trim()) continue;

      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      // Codex: session_meta carries cwd as the project dir.
      if (provider === "codex" && codexCwd === null && raw.type === "session_meta") {
        const payload = raw.payload as Record<string, unknown> | undefined;
        if (payload && typeof payload.cwd === "string") {
          codexCwd = payload.cwd;
        }
      }

      // Claude: first message with `type === "user"` and non-tool
      // content blocks is the prompt.
      if (provider === "claude" && !firstPrompt) {
        const message = raw.message as Record<string, unknown> | undefined;
        const messageRole = message?.role ?? raw.type;
        if (
          (message && messageRole === "user") ||
          raw.type === "user"
        ) {
          const extracted = extractClaudeUserText(message ?? raw);
          if (extracted) firstPrompt = extracted.slice(0, FIRST_PROMPT_MAX_LENGTH);
        }
      }

      // Codex: user_message payload OR response_item with role user.
      if (provider === "codex" && !firstPrompt) {
        const payload = raw.payload as Record<string, unknown> | undefined;
        if (
          raw.type === "event_msg" &&
          payload?.type === "user_message" &&
          typeof payload.message === "string"
        ) {
          firstPrompt = payload.message.slice(0, FIRST_PROMPT_MAX_LENGTH);
        } else if (
          raw.type === "response_item" &&
          payload?.type === "message" &&
          payload.role === "user"
        ) {
          const text = extractCodexContentText(payload.content);
          if (text) firstPrompt = text.slice(0, FIRST_PROMPT_MAX_LENGTH);
        }
      }

      // Short-circuit once we have everything we needed.
      if (firstPrompt && (provider === "claude" || codexCwd !== null)) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { firstPrompt, codexCwd };
}

function extractClaudeUserText(source: unknown): string {
  if (!source || typeof source !== "object") return "";
  const content = (source as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;
    if (entry.type === "text" && typeof entry.text === "string") return entry.text;
    // Skip tool_result blocks — those are tool responses, not the user's text.
  }
  return "";
}

function extractCodexContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;
    if (typeof entry.text === "string") return entry.text;
    if (typeof entry.content === "string") return entry.content;
  }
  return "";
}

async function buildEntry(
  filePath: string,
  provider: "claude" | "codex",
  claudeProjectDir: string | null,
): Promise<SessionSearchEntry | null> {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size === 0) return null;
    if (stat.size > MAX_FILE_SIZE_FOR_INDEX) return null;

    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.entry;
    }

    const { firstPrompt, codexCwd } = await readFirstPromptAndMeta(
      filePath,
      provider,
    );

    const projectDir =
      provider === "claude"
        ? claudeProjectDir ?? ""
        : codexCwd ?? "";

    if (!projectDir) return null;

    const entry: SessionSearchEntry = {
      sessionId: path.basename(filePath, ".jsonl"),
      provider,
      projectDir,
      filePath,
      firstPrompt,
      startedAt: new Date(stat.birthtimeMs).toISOString(),
      lastActivityAt: new Date(stat.mtimeMs).toISOString(),
      estimatedMessageCount: Math.max(
        1,
        Math.round(stat.size / AVG_LINE_BYTES_ESTIMATE),
      ),
      fileSize: stat.size,
    };

    fileCache.set(filePath, { entry, mtimeMs: stat.mtimeMs });
    return entry;
  } catch {
    return null;
  }
}

/**
 * Enumerate sessions belonging to any of the given project
 * directories. If the caller passes an empty list, returns an empty
 * list — the caller is expected to own the "which projects" logic
 * (typically "projects currently on the canvas").
 */
export async function listSessionsForProjects(
  projectDirs: string[],
): Promise<SessionSearchEntry[]> {
  if (projectDirs.length === 0) return [];

  const projectSet = new Set(projectDirs);
  const results: SessionSearchEntry[] = [];

  // -- Claude --
  const claudeRoot = path.join(os.homedir(), ".claude", "projects");
  for (const projectDir of projectDirs) {
    const encoded = encodeProjectPathForClaude(projectDir);
    const claudeProjectDir = path.join(claudeRoot, encoded);
    try {
      const stat = await fsp.stat(claudeProjectDir);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    let entries: string[];
    try {
      entries = await fsp.readdir(claudeProjectDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const filePath = path.join(claudeProjectDir, entry);
      const built = await buildEntry(filePath, "claude", projectDir);
      if (built) results.push(built);
    }
  }

  // -- Codex --
  // Codex doesn't scope by project in its filesystem layout, so we
  // walk all codex jsonls and filter by the cwd we read from
  // session_meta. Expensive only on first pass — subsequent calls
  // hit the file cache (mtime-keyed) for unchanged files.
  const codexFiles = findCodexJsonlFiles();
  for (const filePath of codexFiles) {
    const built = await buildEntry(filePath, "codex", null);
    if (built && projectSet.has(built.projectDir)) {
      results.push(built);
    }
  }

  results.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return results;
}

/**
 * Expose for tests and for an eventual "the file changed, drop its
 * cache entry" hook if we wire into SessionWatcher later.
 */
export function invalidateSessionIndexForFile(filePath: string): void {
  fileCache.delete(filePath);
}

export function clearSessionIndexCache(): void {
  fileCache.clear();
}

/**
 * Decode a Claude-style encoded project dir back to the real path.
 * Exported for edge cases where a caller has only the encoded form.
 */
export { decodeClaudeEncodedPath, encodeProjectPathForClaude };
