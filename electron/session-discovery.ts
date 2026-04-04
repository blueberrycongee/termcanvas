import fs from "fs";
import os from "os";
import path from "path";
import { resolveSessionFile } from "./session-watcher";

export interface FoundSession {
  sessionId: string;
  filePath: string;
  confidence: "strong" | "medium" | "weak";
}

interface CodexSessionIndexEntry {
  id?: string;
  updated_at?: string;
}

interface RecentCodexSessionFile {
  sessionId: string;
  filePath: string;
  mtimeMs: number;
  cwd: string | null;
  timestampMs: number | null;
}

const CODEX_SESSION_LOOKBACK_DAYS = 7;
const CODEX_INDEX_RECENT_LIMIT = 24;
const CODEX_FALLBACK_SCAN_LIMIT = 32;

function safeParseJson(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readCodexSessionMeta(filePath: string): {
  sessionId: string | null;
  cwd: string | null;
  timestampMs: number | null;
} {
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").slice(0, 20);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as { type?: string; payload?: Record<string, unknown> };
      if (parsed.type !== "session_meta" || !parsed.payload) continue;
      const sessionId =
        typeof parsed.payload.id === "string" ? parsed.payload.id : null;
      const cwd = typeof parsed.payload.cwd === "string" ? parsed.payload.cwd : null;
      const timestampMs =
        typeof parsed.payload.timestamp === "string"
          ? new Date(parsed.payload.timestamp).getTime()
          : null;
      return { sessionId, cwd, timestampMs };
    }
  } catch {
  }
  return { sessionId: null, cwd: null, timestampMs: null };
}

function readJsonlTailLines(filePath: string, limit: number): string[] {
  if (limit <= 0) return [];

  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return [];
  }

  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize === 0) return [];

    let cursor = fileSize;
    let leftover = "";
    const lines: string[] = [];

    while (cursor > 0 && lines.length < limit) {
      const readBytes = Math.min(CHUNK_BYTES, cursor);
      cursor -= readBytes;
      const buf = Buffer.alloc(readBytes);
      fs.readSync(fd, buf, 0, readBytes, cursor);

      const chunk = buf.toString("utf-8") + leftover;
      const parts = chunk.split("\n");
      leftover = parts[0] ?? "";

      for (let i = parts.length - 1; i >= 1 && lines.length < limit; i -= 1) {
        const line = parts[i]?.trim();
        if (line) {
          lines.push(line);
        }
      }
    }

    const firstLine = leftover.trim();
    if (firstLine && lines.length < limit) {
      lines.push(firstLine);
    }

    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

function getCodexSessionIndexPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".codex", "session_index.jsonl");
}

function readRecentCodexSessionIndexEntries(
  homeDir = os.homedir(),
  limit = CODEX_INDEX_RECENT_LIMIT,
): Array<{ sessionId: string; updatedAtMs: number | null }> {
  const indexPath = getCodexSessionIndexPath(homeDir);
  if (!fs.existsSync(indexPath)) {
    return [];
  }

  const entries: Array<{ sessionId: string; updatedAtMs: number | null }> = [];
  const seen = new Set<string>();

  for (const line of readJsonlTailLines(indexPath, limit * 3)) {
    let parsed: CodexSessionIndexEntry;
    try {
      parsed = JSON.parse(line) as CodexSessionIndexEntry;
    } catch {
      continue;
    }

    if (typeof parsed.id !== "string" || parsed.id.length === 0 || seen.has(parsed.id)) {
      continue;
    }

    seen.add(parsed.id);
    entries.push({
      sessionId: parsed.id,
      updatedAtMs:
        typeof parsed.updated_at === "string"
          ? new Date(parsed.updated_at).getTime()
          : null,
    });

    if (entries.length >= limit) {
      break;
    }
  }

  return entries;
}

function listRecentCodexSessionFiles(homeDir = os.homedir()): RecentCodexSessionFile[] {
  const sessionsDir = path.join(homeDir, ".codex", "sessions");
  const files: RecentCodexSessionFile[] = [];
  const now = new Date();

  for (let d = 0; d < CODEX_SESSION_LOOKBACK_DAYS; d += 1) {
    const date = new Date(now.getTime() - d * 86_400_000);
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const dayDir = path.join(sessionsDir, yyyy, mm, dd);
    if (!fs.existsSync(dayDir)) {
      continue;
    }

    let dayEntries: string[];
    try {
      dayEntries = fs.readdirSync(dayDir);
    } catch {
      continue;
    }

    for (const entry of dayEntries) {
      if (!entry.endsWith(".jsonl")) {
        continue;
      }
      const filePath = path.join(dayDir, entry);
      try {
        const stat = fs.statSync(filePath);
        const meta = readCodexSessionMeta(filePath);
        files.push({
          sessionId: meta.sessionId ?? path.basename(entry, ".jsonl"),
          filePath,
          mtimeMs: stat.mtimeMs,
          cwd: meta.cwd,
          timestampMs: meta.timestampMs,
        });
      } catch {
        continue;
      }
    }
  }

  return files;
}

export function readLatestCodexSessionId(homeDir = os.homedir()): string | null {
  const latest = readRecentCodexSessionIndexEntries(homeDir, 1)[0];
  return latest?.sessionId ?? null;
}

export function findBestCodexSession(
  cwd: string,
  startedAt?: string,
  homeDir = os.homedir(),
): FoundSession | null {
  const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const recentFiles = listRecentCodexSessionFiles(homeDir);
  const recentFileMap = new Map(
    recentFiles.map((entry) => [entry.sessionId, entry]),
  );

  const indexedCandidates = readRecentCodexSessionIndexEntries(homeDir)
    .map((entry) => {
      const recentFile = recentFileMap.get(entry.sessionId);
      if (!recentFile) {
        return null;
      }
      if (recentFile.cwd !== cwd) {
        return null;
      }
      const anchorMs = Number.isFinite(recentFile.timestampMs ?? NaN)
        ? recentFile.timestampMs!
        : Number.isFinite(entry.updatedAtMs ?? NaN)
          ? entry.updatedAtMs!
          : recentFile.mtimeMs;
      const distance = Number.isFinite(startedMs) ? Math.abs(anchorMs - startedMs) : 0;
      return {
        sessionId: entry.sessionId,
        filePath: recentFile.filePath,
        confidence: "medium" as const,
        anchorMs,
        distance,
      };
    })
    .filter(
      (candidate): candidate is {
        sessionId: string;
        filePath: string;
        confidence: "medium";
        anchorMs: number;
        distance: number;
      } => candidate !== null,
    )
    .sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      return right.anchorMs - left.anchorMs;
    });

  if (indexedCandidates.length > 0) {
    const { sessionId, filePath, confidence } = indexedCandidates[0];
    return { sessionId, filePath, confidence };
  }

  const fallbackCandidates = [...recentFiles]
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, CODEX_FALLBACK_SCAN_LIMIT)
    .map((entry) => {
      if (entry.cwd !== cwd) {
        return null;
      }
      const anchorMs = Number.isFinite(entry.timestampMs ?? NaN)
        ? entry.timestampMs!
        : entry.mtimeMs;
      const distance = Number.isFinite(startedMs) ? Math.abs(anchorMs - startedMs) : 0;
      return {
        sessionId: entry.sessionId,
        filePath: entry.filePath,
        confidence: "medium" as const,
        anchorMs,
        distance,
      };
    })
    .filter(
      (candidate): candidate is {
        sessionId: string;
        filePath: string;
        confidence: "medium";
        anchorMs: number;
        distance: number;
      } => candidate !== null,
    )
    .sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      return right.anchorMs - left.anchorMs;
    });

  if (fallbackCandidates.length > 0) {
    const { sessionId, filePath, confidence } = fallbackCandidates[0];
    return { sessionId, filePath, confidence };
  }

  const latestSessionId = readLatestCodexSessionId(homeDir);
  if (!latestSessionId) {
    return null;
  }

  return {
    sessionId: latestSessionId,
    filePath: recentFileMap.get(latestSessionId)?.filePath ?? "",
    confidence: "weak",
  };
}

interface ClaudeSessionSidecar {
  pid: number | null;
  cwd: string | null;
  startedAtMs: number | null;
  sessionId: string | null;
  filePath: string;
}

function readClaudeSessionSidecar(filePath: string): ClaudeSessionSidecar | null {
  const parsed = safeParseJson(filePath);
  if (!parsed) return null;
  return {
    pid: typeof parsed.pid === "number" ? parsed.pid : null,
    cwd: typeof parsed.cwd === "string" ? parsed.cwd : null,
    startedAtMs:
      typeof parsed.startedAt === "number"
        ? parsed.startedAt
        : typeof parsed.startedAt === "string"
          ? new Date(parsed.startedAt).getTime()
          : null,
    sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
    filePath,
  };
}

export function findBestClaudeSession(
  cwd: string,
  startedAt?: string,
  pid?: number | null,
  homeDir = os.homedir(),
): FoundSession | null {
  const sessionsDir = path.join(homeDir, ".claude", "sessions");
  const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;

  if (typeof pid === "number") {
    const exactPath = path.join(sessionsDir, `${pid}.json`);
    const exact = readClaudeSessionSidecar(exactPath);
    if (exact?.sessionId) {
      return {
        sessionId: exact.sessionId,
        filePath: exact.filePath,
        confidence: "strong",
      };
    }
  }

  let files: string[] = [];
  try {
    files = fs.readdirSync(sessionsDir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => path.join(sessionsDir, entry));
  } catch {
    return null;
  }

  const candidates = files
    .map((filePath) => readClaudeSessionSidecar(filePath))
    .filter((entry): entry is ClaudeSessionSidecar => entry !== null)
    .filter((entry) => entry.cwd === cwd && typeof entry.sessionId === "string")
    .map((entry) => {
      const stat = fs.statSync(entry.filePath);
      const anchorMs = Number.isFinite(entry.startedAtMs ?? NaN)
        ? entry.startedAtMs!
        : stat.mtimeMs;
      const distance = Number.isFinite(startedMs) ? Math.abs(anchorMs - startedMs) : 0;
      return {
        sessionId: entry.sessionId!,
        filePath: entry.filePath,
        confidence: Number.isFinite(startedMs) ? "medium" as const : "weak" as const,
        anchorMs,
        distance,
      };
    })
    .sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      return right.anchorMs - left.anchorMs;
    });

  if (candidates.length === 0) {
    return null;
  }

  const { sessionId, filePath, confidence } = candidates[0];
  return { sessionId, filePath, confidence };
}

const CHUNK_BYTES = 64 * 1024;
const MAX_SCAN_BYTES = 512 * 1024;

/**
 * Scan a JSONL file backwards in 64KB chunks (up to 512KB total) looking
 * for a line matching {@link needle}.  Returns the first (most recent)
 * matching line, or null.
 */
function scanTailForLine(filePath: string, needle: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return null;
  }

  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize === 0) return null;

    let scanned = 0;
    let cursor = fileSize;
    let leftover = "";

    while (scanned < MAX_SCAN_BYTES && cursor > 0) {
      const readBytes = Math.min(CHUNK_BYTES, cursor);
      cursor -= readBytes;
      const buf = Buffer.alloc(readBytes);
      fs.readSync(fd, buf, 0, readBytes, cursor);

      const chunk = buf.toString("utf-8") + leftover;
      const lines = chunk.split("\n");
      // First element may be a partial line — carry it over
      leftover = lines[0];

      // Scan from the end of this chunk
      for (let i = lines.length - 1; i >= 1; i--) {
        if (lines[i].includes(needle)) {
          return lines[i];
        }
      }

      scanned += readBytes;
    }

    // Check the very first piece (leftover from the last iteration)
    if (leftover.includes(needle)) {
      return leftover;
    }

    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read the permissionMode from a Claude session JSONL (last user entry).
 * Returns "bypassPermissions" for --dangerously-skip-permissions, or null.
 */
export function readClaudeSessionPermissionMode(
  sessionId: string,
  cwd: string,
): string | null {
  const filePath = resolveSessionFile(sessionId, "claude", cwd);
  if (!filePath) return null;

  const line = scanTailForLine(filePath, '"permissionMode"');
  if (!line) return null;

  try {
    const entry = JSON.parse(line) as {
      type?: string;
      permissionMode?: string;
    };
    if (entry.type === "user" && typeof entry.permissionMode === "string") {
      return entry.permissionMode;
    }
  } catch {
    // malformed
  }

  return null;
}

/**
 * Read approval/sandbox policy from a Codex session JSONL (last turn_context).
 * Returns true when running with --dangerously-bypass-approvals-and-sandbox.
 */
export function readCodexSessionBypassState(
  sessionId: string,
  cwd: string,
): boolean {
  const filePath = resolveSessionFile(sessionId, "codex", cwd);
  if (!filePath) return false;

  const line = scanTailForLine(filePath, '"approval_policy"');
  if (!line) return false;

  try {
    const entry = JSON.parse(line) as {
      type?: string;
      payload?: {
        approval_policy?: string;
        sandbox_policy?: { type?: string };
      };
    };
    if (entry.type === "turn_context" && entry.payload) {
      const { approval_policy, sandbox_policy } = entry.payload;
      return (
        approval_policy === "never" &&
        sandbox_policy?.type === "danger-full-access"
      );
    }
  } catch {
    // malformed
  }

  return false;
}
