import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractUserPromptText } from "./session-scanner.ts";

/**
 * Fork a Claude session at a user-prompt boundary into a new JSONL
 * file in the same project directory.
 *
 * The fork keeps every line from the start of the source file through
 * the END of the turn at `turnIndex` — that is, up to and including
 * any assistant/tool/thinking lines that follow the chosen user prompt
 * until either the next user prompt or end-of-file. Lines that
 * carried the OLD session id (only the `sessionId` field, never UUIDs
 * that identify individual messages) get rewritten to the new id.
 *
 * The new file lands at `<sourceDir>/<newId>.jsonl`. `<newId>` is the
 * file stem AND the resume id Claude expects via `--resume <id>`.
 *
 * The watcher tails the project directory for new sessions, so the
 * write must be atomic — write to `<newId>.jsonl.tmp` first, then
 * `fs.rename` into place. A partial file would be picked up mid-flight
 * and produce a half-loaded session in the sidebar.
 */

const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const CODEX_SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");

export interface ForkSessionResult {
  newSessionId: string;
  newFilePath: string;
}

export type ForkTargetProvider = "claude" | "codex";

type SourceProvider = "claude" | "codex";

function detectSourceProvider(sourceFilePath: string): SourceProvider {
  const resolved = path.resolve(sourceFilePath);
  const claudeRel = path.relative(path.resolve(CLAUDE_PROJECTS_ROOT), resolved);
  if (!claudeRel.startsWith("..") && !path.isAbsolute(claudeRel)) {
    return "claude";
  }
  const codexRel = path.relative(path.resolve(CODEX_SESSIONS_ROOT), resolved);
  if (!codexRel.startsWith("..") && !path.isAbsolute(codexRel)) {
    return "codex";
  }
  throw new Error(
    `Source path must live under ${CLAUDE_PROJECTS_ROOT} or ${CODEX_SESSIONS_ROOT}: ${sourceFilePath}`,
  );
}

/**
 * Provider-agnostic fork entry point. Inspects the source path to
 * decide whether the file is a Claude or Codex session, then calls
 * the matching implementation. When `targetProvider` is omitted the
 * fork stays within the same provider (backward-compatible same-
 * provider fork). When it differs from the source provider, dispatch
 * to a cross-provider translator that emits text-only conversation
 * history in the target provider's resume format.
 */
export async function forkSession(
  sourceFilePath: string,
  turnIndex: number,
  targetProvider?: ForkTargetProvider,
): Promise<ForkSessionResult> {
  const source = detectSourceProvider(sourceFilePath);
  const target: ForkTargetProvider = targetProvider ?? source;
  if (source === "claude" && target === "claude") {
    return forkClaudeSession(sourceFilePath, turnIndex);
  }
  if (source === "claude" && target === "codex") {
    return forkClaudeToCodex(sourceFilePath, turnIndex);
  }
  if (source === "codex" && target === "codex") {
    return forkCodexSession(sourceFilePath, turnIndex);
  }
  if (source === "codex" && target === "claude") {
    return forkCodexToClaude(sourceFilePath, turnIndex);
  }
  throw new Error(`Unsupported fork pairing: ${source} -> ${target}`);
}

export async function forkClaudeSession(
  sourceFilePath: string,
  turnIndex: number,
): Promise<ForkSessionResult> {
  if (!Number.isInteger(turnIndex) || turnIndex < 0) {
    throw new Error(`Invalid turnIndex: ${turnIndex}`);
  }

  const resolvedSource = path.resolve(sourceFilePath);
  const resolvedRoot = path.resolve(CLAUDE_PROJECTS_ROOT);
  const rel = path.relative(resolvedRoot, resolvedSource);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Source path must live under ${CLAUDE_PROJECTS_ROOT}: ${sourceFilePath}`,
    );
  }
  if (!resolvedSource.endsWith(".jsonl")) {
    throw new Error(`Source path must be a .jsonl file: ${sourceFilePath}`);
  }

  const sourceDir = path.dirname(resolvedSource);
  const oldSessionId = path.basename(resolvedSource, ".jsonl");

  const content = await fsp.readFile(resolvedSource, "utf-8");
  const rawLines = content.split("\n");
  // Track the trailing newline so the new file's terminator matches
  // the source's. Claude's writer always ends with a newline; we keep
  // the same convention rather than guessing.
  const sourceEndedWithNewline =
    rawLines.length > 0 && rawLines[rawLines.length - 1] === "";
  const lines = rawLines.filter((l) => l.length > 0);

  // Walk lines in order. Each time `extractUserPromptText` returns
  // non-empty we cross a turn boundary. The first such crossing is
  // turn 0; we keep accumulating lines until we either start the
  // (turnIndex+1)-th turn — at which point we stop — or run out of
  // lines.
  const kept: string[] = [];
  let userPromptCount = 0;
  let pastFork = false;
  for (const line of lines) {
    let raw: Record<string, unknown> | null = null;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Malformed lines belong to whichever turn was open at the time
      // — keep them with the prior turn so we don't drop user-relevant
      // context just because one entry was unparseable.
    }

    const isUserPrompt = raw ? extractUserPromptText(raw) !== "" : false;

    if (isUserPrompt) {
      if (userPromptCount === turnIndex + 1) {
        // We've reached the start of the turn AFTER the fork point —
        // stop here. Everything from the fork-target turn through the
        // last assistant/tool line before this entry is in `kept`.
        pastFork = true;
        break;
      }
      userPromptCount += 1;
    }
    kept.push(line);
  }

  if (userPromptCount <= turnIndex && !pastFork) {
    // We never reached the requested turn — fewer user prompts than
    // expected. Fail loudly rather than silently producing a fork that
    // includes the whole file.
    throw new Error(
      `Source has ${userPromptCount} user prompt(s); cannot fork at turn ${turnIndex}`,
    );
  }

  // Rewrite the kept lines, substituting the session id. Only string
  // values that exactly equal `oldSessionId` and live in a field
  // literally named `sessionId` are touched. Per repo inspection of
  // every Claude JSONL on disk, that is the ONLY field that carries
  // the session id; `uuid` / `parentUuid` / `messageId` / `id` /
  // `promptId` identify per-message, not per-session, and must not
  // be touched (rewriting them would invalidate Claude's parent
  // pointers and corrupt the conversation graph).
  const newSessionId = await allocateNewSessionId(sourceDir);
  const rewritten = kept.map((line) => substituteSessionId(line, oldSessionId, newSessionId));

  const newFilePath = path.join(sourceDir, `${newSessionId}.jsonl`);
  const tmpPath = `${newFilePath}.tmp`;
  const body = rewritten.join("\n") + (sourceEndedWithNewline ? "\n" : "");
  await fsp.writeFile(tmpPath, body, { encoding: "utf-8", mode: 0o600 });
  await fsp.rename(tmpPath, newFilePath);

  return { newSessionId, newFilePath };
}

async function allocateNewSessionId(sourceDir: string): Promise<string> {
  // Collisions are astronomically unlikely with v4 UUIDs; the loop is
  // a cheap belt-and-suspenders so we never overwrite a sibling.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = crypto.randomUUID();
    const candidatePath = path.join(sourceDir, `${candidate}.jsonl`);
    const candidateTmp = `${candidatePath}.tmp`;
    try {
      await fsp.access(candidatePath, fs.constants.F_OK);
      continue;
    } catch {
      // not present — also make sure no in-flight tmp would clobber
      try {
        await fsp.access(candidateTmp, fs.constants.F_OK);
        continue;
      } catch {
        return candidate;
      }
    }
  }
  throw new Error("Failed to allocate a unique session id after 8 attempts");
}

function substituteSessionId(
  line: string,
  oldSessionId: string,
  newSessionId: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Unparseable: leave as-is. We deliberately do NOT do a string
    // replace fallback — that would risk rewriting a substring that
    // happens to equal the session id by coincidence.
    return line;
  }
  const swapped = swapSessionIds(parsed, oldSessionId, newSessionId);
  return JSON.stringify(swapped);
}

function swapSessionIds(
  value: unknown,
  oldSessionId: string,
  newSessionId: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => swapSessionIds(v, oldSessionId, newSessionId));
  }
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      const child = src[key];
      if (key === "sessionId" && child === oldSessionId) {
        out[key] = newSessionId;
      } else {
        out[key] = swapSessionIds(child, oldSessionId, newSessionId);
      }
    }
    return out;
  }
  return value;
}

/**
 * Fork a Codex rollout JSONL at a user-prompt boundary into a new
 * file under today's `~/.codex/sessions/YYYY/MM/DD/` dir.
 *
 * Differences from the Claude fork:
 *
 *  - The resume-able id lives in `session_meta.payload.id` on the
 *    first line, NOT in the filename. The on-disk file is normally
 *    named `rollout-<ts>-<uuid>.jsonl`, but `codex resume` finds
 *    sessions by scanning JSONLs and matching `payload.id`. So the
 *    new file's name only needs to be unique; we use `<new-uuid>.jsonl`.
 *
 *  - The destination directory is today's date dir, matching the
 *    convention Codex itself uses when creating fresh sessions.
 *    Created with `mkdir -p` if absent.
 *
 *  - Substitution is narrower: only `payload.id` on the
 *    `session_meta` line gets rewritten. Verified against the
 *    rollout schema (`thirdparty/codex/codex-rs/protocol/src/protocol.rs`
 *    SessionMeta / SessionMetaLine / RolloutItem) — every other
 *    UUID-shaped value (`response_item.id`, turn ids, message ids,
 *    `forked_from_id`) identifies per-message or per-turn state and
 *    rewriting them would corrupt the conversation graph. The user
 *    verified that rewriting only `session_meta.payload.id` is
 *    sufficient for `codex resume <new-uuid>` to succeed.
 *
 *  - First-line shape is validated up-front (must be `type:
 *    "session_meta"` with a string `payload.id`); we fail loudly
 *    rather than silently producing an unresumable file.
 *
 * Turn-boundary detection uses the same `extractUserPromptText`
 * predicate as Claude, so the fork UI's `turnIndex` agrees with
 * what the replay view shows.
 */
export async function forkCodexSession(
  sourceFilePath: string,
  turnIndex: number,
): Promise<ForkSessionResult> {
  if (!Number.isInteger(turnIndex) || turnIndex < 0) {
    throw new Error(`Invalid turnIndex: ${turnIndex}`);
  }

  const resolvedSource = path.resolve(sourceFilePath);
  const resolvedRoot = path.resolve(CODEX_SESSIONS_ROOT);
  const rel = path.relative(resolvedRoot, resolvedSource);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Source path must live under ${CODEX_SESSIONS_ROOT}: ${sourceFilePath}`,
    );
  }
  if (!resolvedSource.endsWith(".jsonl")) {
    throw new Error(`Source path must be a .jsonl file: ${sourceFilePath}`);
  }

  const content = await fsp.readFile(resolvedSource, "utf-8");
  const rawLines = content.split("\n");
  const sourceEndedWithNewline =
    rawLines.length > 0 && rawLines[rawLines.length - 1] === "";
  const lines = rawLines.filter((l) => l.length > 0);

  const oldSessionId = readCodexSessionMetaId(lines[0] ?? "");
  if (!oldSessionId) {
    throw new Error(
      `Codex source has no session_meta.payload.id on the first line: ${sourceFilePath}`,
    );
  }

  const kept: string[] = [];
  let userPromptCount = 0;
  let pastFork = false;
  for (const line of lines) {
    let raw: Record<string, unknown> | null = null;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Same policy as the Claude path: malformed lines belong to
      // whichever turn is open at the time so we don't drop user-
      // relevant context just because one entry was unparseable.
    }

    const isUserPrompt = raw ? extractUserPromptText(raw) !== "" : false;

    if (isUserPrompt) {
      if (userPromptCount === turnIndex + 1) {
        pastFork = true;
        break;
      }
      userPromptCount += 1;
    }
    kept.push(line);
  }

  if (userPromptCount <= turnIndex && !pastFork) {
    throw new Error(
      `Source has ${userPromptCount} user prompt(s); cannot fork at turn ${turnIndex}`,
    );
  }

  const now = new Date();
  const yyyy = String(now.getFullYear()).padStart(4, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const destDir = path.join(CODEX_SESSIONS_ROOT, yyyy, mm, dd);
  await fsp.mkdir(destDir, { recursive: true });

  const newSessionId = await allocateNewCodexSessionId(destDir);
  const rewritten = kept.map((line) =>
    rewriteCodexSessionMetaId(line, oldSessionId, newSessionId),
  );

  const newFilePath = path.join(destDir, `${newSessionId}.jsonl`);
  const tmpPath = `${newFilePath}.tmp`;
  const body = rewritten.join("\n") + (sourceEndedWithNewline ? "\n" : "");
  await fsp.writeFile(tmpPath, body, { encoding: "utf-8", mode: 0o600 });
  await fsp.rename(tmpPath, newFilePath);

  return { newSessionId, newFilePath };
}

function readCodexSessionMetaId(line: string): string | null {
  if (!line) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type !== "session_meta") return null;
  const payload = obj.payload;
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function rewriteCodexSessionMetaId(
  line: string,
  oldSessionId: string,
  newSessionId: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }
  if (!parsed || typeof parsed !== "object") return line;
  const raw = parsed as Record<string, unknown>;
  if (raw.type !== "session_meta") return line;
  const payload = raw.payload;
  if (!payload || typeof payload !== "object") return line;
  const p = payload as Record<string, unknown>;
  if (p.id !== oldSessionId) return line;
  return JSON.stringify({ ...raw, payload: { ...p, id: newSessionId } });
}

async function allocateNewCodexSessionId(destDir: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = crypto.randomUUID();
    const candidatePath = path.join(destDir, `${candidate}.jsonl`);
    const candidateTmp = `${candidatePath}.tmp`;
    try {
      await fsp.access(candidatePath, fs.constants.F_OK);
      continue;
    } catch {
      try {
        await fsp.access(candidateTmp, fs.constants.F_OK);
        continue;
      } catch {
        return candidate;
      }
    }
  }
  throw new Error("Failed to allocate a unique session id after 8 attempts");
}

/* -------------------------------------------------------------------
 * Cross-provider translators
 *
 * Issue #148 L2: convert a Claude session to a Codex resume file or
 * vice-versa. The output is intentionally lossy — only user prompts
 * and assistant text replies survive; tool calls / tool results /
 * thinking blocks are dropped. This is the minimum the user verified
 * each CLI accepts on `--resume`, and it's also the maximum we can
 * reasonably translate: the two providers' tool-call schemas are not
 * 1:1 mappable and a literal carry-over would refer to tool ids /
 * call ids the new agent has never issued.
 * ----------------------------------------------------------------- */

/**
 * Encode a cwd into Claude's project-key directory name.
 * Verified rule: every '/' AND every '.' becomes '-'. No reverse
 * decoding because the mapping is lossy (so we never round-trip).
 */
function claudeProjectKeyForCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

interface FlatTextEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

/**
 * Walk Claude lines and keep everything from the start of file through
 * the END of the turn at `turnIndex`. Same predicate / boundary logic
 * as `forkClaudeSession`, factored only enough to share with the
 * cross-provider translator without altering the same-provider
 * implementation.
 */
function keepThroughTurn(
  lines: string[],
  turnIndex: number,
): { kept: string[]; userPromptCount: number; pastFork: boolean } {
  const kept: string[] = [];
  let userPromptCount = 0;
  let pastFork = false;
  for (const line of lines) {
    let raw: Record<string, unknown> | null = null;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Match same-provider policy: keep malformed lines with the
      // open turn so a single garbled entry doesn't drop user-relevant
      // context. We only consult the parsed form to detect the
      // user-prompt boundary.
    }
    const isUserPrompt = raw ? extractUserPromptText(raw) !== "" : false;
    if (isUserPrompt) {
      if (userPromptCount === turnIndex + 1) {
        pastFork = true;
        break;
      }
      userPromptCount += 1;
    }
    kept.push(line);
  }
  return { kept, userPromptCount, pastFork };
}

function findClaudeSourceCwd(lines: string[]): string | null {
  // Claude entries normally carry `cwd` at the top level. Scan a
  // generous prefix in case the very first line is a permission-mode
  // / file-history header that lacks cwd. Bail at 32 lines — the cwd
  // is on essentially every prompt entry, so if it's not in the first
  // few it isn't there.
  for (let i = 0; i < Math.min(lines.length, 32); i += 1) {
    let raw: unknown;
    try {
      raw = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const cwd = obj.cwd;
    if (typeof cwd === "string" && cwd.length > 0) return cwd;
  }
  return null;
}

function deriveClaudeCwdFromPath(sourceFilePath: string): string {
  // Best-effort fallback when no entry carries `cwd`. The project key
  // is a lossy `cwd.replace(/[\/.]/g, '-')` so we can't recover the
  // original — but we can produce a path-shaped string by treating
  // every '-' as '/'. The result is wrong whenever the real cwd
  // contained dots or hyphens; we still emit it so the new Codex
  // session has *some* cwd, then the resumed agent can correct
  // course. Verified: Codex resume tolerates a non-existent cwd.
  const projectKey = path.basename(path.dirname(path.resolve(sourceFilePath)));
  return projectKey.replace(/-/g, "/");
}

/**
 * Pull the user-typed text out of a Claude `type: "user"` entry.
 * Reuses `extractUserPromptText` so synthetic blocks (system-reminder,
 * CLAUDE.md injection, /resume housekeeping) get stripped exactly the
 * same way the replay timeline strips them. Returns "" when the entry
 * is entirely synthetic / a tool_result-only echo.
 */
function readClaudeUserText(raw: Record<string, unknown>): string {
  return extractUserPromptText(raw);
}

/**
 * Walk a Claude `type: "assistant"` entry and concatenate every
 * text-block's `.text`. Skips thinking blocks (tool_use blocks must be
 * filtered out at the LINE level upstream — once any tool_use is in
 * the message Claude rejects the whole entry on resume, so we drop the
 * entire line, not just the tool_use blocks).
 */
function readClaudeAssistantText(raw: Record<string, unknown>): string {
  const message = raw.message as Record<string, unknown> | undefined;
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;
    if (entry.type === "text" && typeof entry.text === "string") {
      out.push(entry.text);
    }
  }
  return out.join("");
}

function getTimestamp(raw: Record<string, unknown>): string {
  const ts = raw.timestamp;
  if (typeof ts === "string" && ts) return ts;
  // Codex `response_item` lines have the timestamp on the wrapper, not
  // the payload — caller passes the wrapper, so the lookup above hits.
  // If it's missing entirely (extremely rare) fall back to "now" so
  // the line still has a parseable timestamp downstream.
  return new Date().toISOString();
}

function claudeUserContentIsToolResultOnly(raw: Record<string, unknown>): boolean {
  const message = raw.message as Record<string, unknown> | undefined;
  if (!message) return false;
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  for (const block of content) {
    if (!block || typeof block !== "object") return false;
    const entry = block as Record<string, unknown>;
    if (entry.type !== "tool_result") return false;
  }
  return true;
}

function claudeAssistantHasToolUse(raw: Record<string, unknown>): boolean {
  const message = raw.message as Record<string, unknown> | undefined;
  if (!message) return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;
    if (entry.type === "tool_use") return true;
  }
  return false;
}

/**
 * Fork a Claude session into a fresh Codex resume file.
 *
 * Output shape (per verification on a real Claude+Codex machine):
 *   line 1    `session_meta` envelope with the minimum fields Codex
 *             needs to mount the file. `originator: "termcanvas-fork"`
 *             flags the session as machine-translated; `model_provider`
 *             stays `"unknown"` because the source is a different
 *             provider entirely.
 *   line 2..  one `response_item` per surviving user / assistant text
 *             entry, with `input_text` / `output_text` content blocks
 *             matching Codex's `ContentItem::InputText` /
 *             `ContentItem::OutputText` variants.
 *
 * Tool calls, tool results, thinking blocks, and any line with
 * `isMeta: true` are dropped. Verified: the resulting session resumes
 * cleanly via `codex resume <new-uuid>` and the new agent references
 * the prior conversation.
 */
export async function forkClaudeToCodex(
  sourceFilePath: string,
  turnIndex: number,
): Promise<ForkSessionResult> {
  if (!Number.isInteger(turnIndex) || turnIndex < 0) {
    throw new Error(`Invalid turnIndex: ${turnIndex}`);
  }

  const resolvedSource = path.resolve(sourceFilePath);
  const resolvedRoot = path.resolve(CLAUDE_PROJECTS_ROOT);
  const rel = path.relative(resolvedRoot, resolvedSource);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Source path must live under ${CLAUDE_PROJECTS_ROOT}: ${sourceFilePath}`,
    );
  }
  if (!resolvedSource.endsWith(".jsonl")) {
    throw new Error(`Source path must be a .jsonl file: ${sourceFilePath}`);
  }

  const content = await fsp.readFile(resolvedSource, "utf-8");
  const lines = content.split("\n").filter((l) => l.length > 0);

  const { kept, userPromptCount, pastFork } = keepThroughTurn(lines, turnIndex);
  if (userPromptCount <= turnIndex && !pastFork) {
    throw new Error(
      `Source has ${userPromptCount} user prompt(s); cannot fork at turn ${turnIndex}`,
    );
  }

  const sourceCwd =
    findClaudeSourceCwd(lines) ?? deriveClaudeCwdFromPath(resolvedSource);

  const flat: FlatTextEntry[] = [];
  for (const line of kept) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (raw.isMeta === true) continue;
    if (raw.type === "user") {
      if (claudeUserContentIsToolResultOnly(raw)) continue;
      const text = readClaudeUserText(raw);
      if (!text) continue;
      flat.push({ role: "user", text, timestamp: getTimestamp(raw) });
      continue;
    }
    if (raw.type === "assistant") {
      if (claudeAssistantHasToolUse(raw)) continue;
      const text = readClaudeAssistantText(raw);
      if (!text) continue;
      flat.push({ role: "assistant", text, timestamp: getTimestamp(raw) });
      continue;
    }
    // Other entry types (file-history-snapshot, permission-mode, etc.)
    // are noise from Codex's perspective — skip.
  }

  const now = new Date();
  const yyyy = String(now.getFullYear()).padStart(4, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const destDir = path.join(CODEX_SESSIONS_ROOT, yyyy, mm, dd);
  await fsp.mkdir(destDir, { recursive: true });

  const newSessionId = await allocateNewCodexSessionId(destDir);
  const newFilePath = path.join(destDir, `${newSessionId}.jsonl`);
  const tmpPath = `${newFilePath}.tmp`;

  const nowIso = now.toISOString();
  const sessionMetaLine = JSON.stringify({
    timestamp: nowIso,
    type: "session_meta",
    payload: {
      id: newSessionId,
      timestamp: nowIso,
      cwd: sourceCwd,
      originator: "termcanvas-fork",
      cli_version: "0.0.0",
      source: "cli",
      model_provider: "unknown",
    },
  });

  const responseLines = flat.map((entry) => {
    const blockType = entry.role === "user" ? "input_text" : "output_text";
    return JSON.stringify({
      timestamp: entry.timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role: entry.role,
        id: crypto.randomUUID(),
        content: [{ type: blockType, text: entry.text }],
      },
    });
  });

  const body = [sessionMetaLine, ...responseLines].join("\n") + "\n";
  await fsp.writeFile(tmpPath, body, { encoding: "utf-8", mode: 0o600 });
  await fsp.rename(tmpPath, newFilePath);

  return { newSessionId, newFilePath };
}

function readCodexResponseText(payload: Record<string, unknown>): string {
  const content = payload.content;
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;
    if (typeof entry.text === "string") {
      out.push(entry.text);
    }
  }
  return out.join("");
}

/**
 * Fork a Codex rollout into a fresh Claude resume file.
 *
 * Output shape (per verification on a real Claude+Codex machine):
 *   one `type: "user"` / `type: "assistant"` Claude entry per surviving
 *   text block. The minimum fields Claude needs to mount the file
 *   (verified): `type`, `sessionId`, `uuid`, `timestamp`, `cwd`,
 *   `message.role`, `message.content` (array of `{type:"text", text}`).
 *   `parentUuid` is omitted — verification confirmed Claude tolerates
 *   orphan parent pointers.
 *
 * Destination: `~/.claude/projects/<projectKey>/<new-uuid>.jsonl`
 * where `projectKey = cwd.replace(/[\/.]/g, '-')`. The project key
 * dir may not exist (Codex-first project that's never had Claude
 * sessions); we mkdir it.
 */
export async function forkCodexToClaude(
  sourceFilePath: string,
  turnIndex: number,
): Promise<ForkSessionResult> {
  if (!Number.isInteger(turnIndex) || turnIndex < 0) {
    throw new Error(`Invalid turnIndex: ${turnIndex}`);
  }

  const resolvedSource = path.resolve(sourceFilePath);
  const resolvedRoot = path.resolve(CODEX_SESSIONS_ROOT);
  const rel = path.relative(resolvedRoot, resolvedSource);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Source path must live under ${CODEX_SESSIONS_ROOT}: ${sourceFilePath}`,
    );
  }
  if (!resolvedSource.endsWith(".jsonl")) {
    throw new Error(`Source path must be a .jsonl file: ${sourceFilePath}`);
  }

  const content = await fsp.readFile(resolvedSource, "utf-8");
  const lines = content.split("\n").filter((l) => l.length > 0);

  const firstLine = lines[0] ?? "";
  let firstParsed: Record<string, unknown> | null = null;
  try {
    firstParsed = JSON.parse(firstLine) as Record<string, unknown>;
  } catch {
    firstParsed = null;
  }
  if (
    !firstParsed ||
    firstParsed.type !== "session_meta" ||
    !firstParsed.payload ||
    typeof firstParsed.payload !== "object"
  ) {
    throw new Error(
      `Codex source has no session_meta on the first line: ${sourceFilePath}`,
    );
  }
  const metaPayload = firstParsed.payload as Record<string, unknown>;
  const sourceCwd = metaPayload.cwd;
  if (typeof sourceCwd !== "string" || sourceCwd.length === 0) {
    throw new Error(
      `Codex session_meta missing payload.cwd: ${sourceFilePath}`,
    );
  }

  const { kept, userPromptCount, pastFork } = keepThroughTurn(lines, turnIndex);
  if (userPromptCount <= turnIndex && !pastFork) {
    throw new Error(
      `Source has ${userPromptCount} user prompt(s); cannot fork at turn ${turnIndex}`,
    );
  }

  const flat: FlatTextEntry[] = [];
  for (const line of kept) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (raw.type !== "response_item") continue;
    const payload = raw.payload;
    if (!payload || typeof payload !== "object") continue;
    const p = payload as Record<string, unknown>;
    if (p.type !== "message") continue;
    if (p.role !== "user" && p.role !== "assistant") continue;
    const text = readCodexResponseText(p);
    if (!text) continue;
    flat.push({
      role: p.role,
      text,
      timestamp: getTimestamp(raw),
    });
  }

  const projectKey = claudeProjectKeyForCwd(sourceCwd);
  const destDir = path.join(CLAUDE_PROJECTS_ROOT, projectKey);
  await fsp.mkdir(destDir, { recursive: true });

  const newSessionId = await allocateNewSessionId(destDir);
  const newFilePath = path.join(destDir, `${newSessionId}.jsonl`);
  const tmpPath = `${newFilePath}.tmp`;

  const claudeLines = flat.map((entry) =>
    JSON.stringify({
      type: entry.role,
      sessionId: newSessionId,
      uuid: crypto.randomUUID(),
      timestamp: entry.timestamp,
      cwd: sourceCwd,
      message: {
        role: entry.role,
        content: [{ type: "text", text: entry.text }],
      },
    }),
  );

  const body = claudeLines.join("\n") + (claudeLines.length > 0 ? "\n" : "");
  await fsp.writeFile(tmpPath, body, { encoding: "utf-8", mode: 0o600 });
  await fsp.rename(tmpPath, newFilePath);

  return { newSessionId, newFilePath };
}
