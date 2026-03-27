import fs from "fs";
import os from "os";
import path from "path";
import { findCodexJsonlFiles } from "./usage-collector";

export interface FoundSession {
  sessionId: string;
  filePath: string;
  confidence: "strong" | "medium" | "weak";
}

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

function readCodexSessionMeta(filePath: string): { cwd: string | null; timestampMs: number | null } {
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").slice(0, 20);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as { type?: string; payload?: Record<string, unknown> };
      if (parsed.type !== "session_meta" || !parsed.payload) continue;
      const cwd = typeof parsed.payload.cwd === "string" ? parsed.payload.cwd : null;
      const timestampMs =
        typeof parsed.payload.timestamp === "string"
          ? new Date(parsed.payload.timestamp).getTime()
          : null;
      return { cwd, timestampMs };
    }
  } catch {
    // ignore parse failures
  }
  return { cwd: null, timestampMs: null };
}

export function findBestCodexSession(
  cwd: string,
  startedAt?: string,
): FoundSession | null {
  const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const files = findCodexJsonlFiles();
  const candidates = files
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      const meta = readCodexSessionMeta(filePath);
      if (meta.cwd !== cwd) {
        return null;
      }
      const anchorMs = Number.isFinite(meta.timestampMs ?? NaN)
        ? meta.timestampMs!
        : stat.mtimeMs;
      const distance = Number.isFinite(startedMs) ? Math.abs(anchorMs - startedMs) : 0;
      return {
        sessionId: path.basename(filePath, ".jsonl"),
        filePath,
        confidence: "medium" as const,
        anchorMs,
        distance,
      };
    })
    .filter((candidate): candidate is FoundSession & { anchorMs: number; distance: number } => candidate !== null)
    .sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      return right.anchorMs - left.anchorMs;
    });

  if (candidates.length > 0) {
    const { sessionId, filePath, confidence } = candidates[0];
    return { sessionId, filePath, confidence };
  }

  try {
    const indexPath = path.join(os.homedir(), ".codex", "session_index.jsonl");
    if (!fs.existsSync(indexPath)) return null;
    const lines = fs.readFileSync(indexPath, "utf-8").trim().split("\n");
    const last = lines[lines.length - 1];
    if (!last) return null;
    const entry = JSON.parse(last) as { id?: string };
    if (!entry.id) return null;
    const fallbackFile = files.find((filePath) => path.basename(filePath).includes(entry.id!));
    return {
      sessionId: entry.id,
      filePath: fallbackFile ?? "",
      confidence: "weak",
    };
  } catch {
    return null;
  }
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
