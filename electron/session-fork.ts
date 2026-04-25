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

export interface ForkSessionResult {
  newSessionId: string;
  newFilePath: string;
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
