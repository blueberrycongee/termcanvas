import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "node:module";
import type {
  NormalizedSessionTelemetryEvent,
  TelemetryTurnState,
} from "../shared/telemetry.ts";

const isDev = !!process.env.VITE_DEV_SERVER_URL;

export type SessionType = "claude" | "codex" | "kimi" | "wuu";

interface CompletionSignal {
  completed: boolean;
}

interface SqliteStatement {
  get(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type DatabaseSyncCtor = new (
  filePath: string,
  options?: { readonly?: boolean },
) => SqliteDatabase;

const require = createRequire(import.meta.url);
let cachedDatabaseSyncCtor: DatabaseSyncCtor | null | undefined;

function getDatabaseSyncCtor(): DatabaseSyncCtor | null {
  if (cachedDatabaseSyncCtor !== undefined) {
    return cachedDatabaseSyncCtor;
  }

  try {
    const mod = require("node:sqlite") as { DatabaseSync?: DatabaseSyncCtor };
    cachedDatabaseSyncCtor =
      typeof mod.DatabaseSync === "function" ? mod.DatabaseSync : null;
  } catch {
    cachedDatabaseSyncCtor = null;
  }

  return cachedDatabaseSyncCtor;
}

function getCodexStateDbPath(homeDir = os.homedir()): string | null {
  const codexDir = path.join(homeDir, ".codex");
  let entries: string[];
  try {
    entries = fs.readdirSync(codexDir);
  } catch {
    return null;
  }

  const candidates = entries
    .map((entry) => {
      const match = /^state_(\d+)\.sqlite$/.exec(entry);
      if (!match) return null;
      return {
        filePath: path.join(codexDir, entry),
        version: Number.parseInt(match[1] ?? "", 10),
      };
    })
    .filter(
      (candidate): candidate is { filePath: string; version: number } =>
        candidate !== null && Number.isFinite(candidate.version),
    )
    .sort((left, right) => right.version - left.version);

  return candidates[0]?.filePath ?? null;
}

function resolveCodexSessionFileFromStateDb(
  sessionId: string,
  homeDir = os.homedir(),
): string | null {
  const dbPath = getCodexStateDbPath(homeDir);
  if (!dbPath || !fs.existsSync(dbPath)) {
    return null;
  }

  const DatabaseSync = getDatabaseSyncCtor();
  if (!DatabaseSync) {
    return null;
  }

  let db: SqliteDatabase | null = null;
  try {
    db = new DatabaseSync(dbPath, { readonly: true });
    const row = db
      .prepare(
        `
      SELECT rollout_path
      FROM threads
      WHERE id = ? AND archived = 0
      LIMIT 1
    `,
      )
      .get(sessionId) as { rollout_path?: string } | undefined;
    return typeof row?.rollout_path === "string" && row.rollout_path.length > 0
      ? row.rollout_path
      : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const entry = block as Record<string, unknown>;
      if (typeof entry.text === "string") return entry.text;
      if (typeof entry.thinking === "string") return entry.thinking;
      if (typeof entry.content === "string") return entry.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildEvent(
  event: Omit<NormalizedSessionTelemetryEvent, "at"> & { at?: string },
): NormalizedSessionTelemetryEvent {
  return {
    meaningful_progress: false,
    ...event,
  };
}

function buildClaudeStopReasonState(
  stopReason: unknown,
): TelemetryTurnState | undefined {
  if (stopReason === "end_turn") return "turn_complete";
  if (stopReason === "tool_use") return "tool_pending";
  if (typeof stopReason === "string" && stopReason.length > 0)
    return "turn_aborted";
  return undefined;
}

/**
 * Pure function: check if the tail of a JSONL file contains a turn-completion signal.
 * Reads the last `tailBytes` of the file to avoid loading the entire file.
 */
export function checkTurnComplete(
  filePath: string,
  type: SessionType,
  tailBytes = 131072,
): CompletionSignal {
  let content: string;
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    if (size === 0) return { completed: false };

    const fd = fs.openSync(filePath, "r");
    try {
      const readSize = Math.min(tailBytes, size);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, size - readSize);
      content = buf.toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { completed: false };
  }

  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  const startIndex =
    type === "wuu" || type === "kimi" ? 0 : Math.max(0, lines.length - 5);
  for (let i = lines.length - 1; i >= startIndex; i--) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    if (type === "claude") {
      if (
        parsed.type === "assistant" &&
        typeof parsed.message === "object" &&
        parsed.message !== null &&
        (parsed.message as Record<string, unknown>).stop_reason === "end_turn"
      ) {
        return { completed: true };
      }
      if (parsed.type === "system" && parsed.subtype === "turn_duration") {
        return { completed: true };
      }
    }

    if (type === "codex") {
      const payload = getObject(parsed.payload);
      if (
        parsed.type === "event_msg" &&
        (payload?.type === "task_complete" || payload?.type === "turn_complete")
      ) {
        return { completed: true };
      }
    }

    if (type === "wuu") {
      const role = getString(parsed.role);
      if (role === "meta" || role === "system") {
        continue;
      }
      if (role === "assistant") {
        const toolCalls = Array.isArray(parsed.tool_calls)
          ? parsed.tool_calls
          : [];
        if (toolCalls.length > 0) {
          return { completed: false };
        }
        return {
          completed: extractTextContent(parsed.content).trim().length > 0,
        };
      }
      if (role === "tool" || role === "user") {
        return { completed: false };
      }
    }

    if (type === "kimi") {
      const role = getString(parsed.role);
      if (role === "system") {
        continue;
      }
      if (role === "assistant") {
        const toolCalls = Array.isArray(parsed.tool_calls)
          ? parsed.tool_calls
          : [];
        if (toolCalls.length > 0) {
          return { completed: false };
        }
        return {
          completed: extractTextContent(parsed.content).trim().length > 0,
        };
      }
      if (role === "tool" || role === "user") {
        return { completed: false };
      }
    }
  }

  return { completed: false };
}

function resolveKimiSessionFile(sessionId: string, cwd: string): string | null {
  const home = os.homedir();
  const metadataPath = path.join(home, ".kimi", "kimi.json");
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as {
      work_dirs?: Array<{ path: string; sessions_dir?: string }>;
    };
    const workDirs = metadata.work_dirs ?? [];
    for (const wd of workDirs) {
      if (wd.path === cwd && wd.sessions_dir) {
        const filePath = path.join(wd.sessions_dir, sessionId, "context.jsonl");
        if (fs.existsSync(filePath)) {
          return filePath;
        }
      }
    }
    // Fallback: compute sessions_dir from path hash (matches kimi-cli logic)
    const crypto = require("node:crypto");
    const pathMd5 = crypto.createHash("md5").update(cwd).digest("hex");
    const fallbackPath = path.join(
      home,
      ".kimi",
      "sessions",
      pathMd5,
      sessionId,
      "context.jsonl",
    );
    if (fs.existsSync(fallbackPath)) {
      return fallbackPath;
    }
  } catch {
    // ignore
  }
  return null;
}

export function toClaudeProjectKey(cwd: string): string {
  return cwd.replaceAll(/[/\\.:]/g, "-");
}

export function resolveSessionFile(
  sessionId: string,
  type: SessionType,
  cwd: string,
): string | null {
  const home = os.homedir();

  if (type === "claude") {
    const projectKey = toClaudeProjectKey(cwd);
    return path.join(
      home,
      ".claude",
      "projects",
      projectKey,
      sessionId + ".jsonl",
    );
  }

  if (type === "codex") {
    // Codex can emit SessionStart before the JSONL is created. The state db
    // already knows the eventual rollout_path, which lets watchers attach to
    // the parent directory immediately instead of failing one-shot resolution.
    const fromStateDb = resolveCodexSessionFileFromStateDb(sessionId, home);
    if (fromStateDb) {
      return fromStateDb;
    }

    const sessionsDir = path.join(home, ".codex", "sessions");
    try {
      const now = new Date();
      for (let d = 0; d < 7; d++) {
        const date = new Date(now.getTime() - d * 86400000);
        const yyyy = String(date.getFullYear());
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        const dayDir = path.join(sessionsDir, yyyy, mm, dd);
        if (!fs.existsSync(dayDir)) continue;
        const files = fs.readdirSync(dayDir);
        const match = files.find((f) => f.includes(sessionId));
        if (match) return path.join(dayDir, match);
      }
    } catch (err) {
      console.warn(
        `[SessionWatcher] codex resolveSessionFile error for session=${sessionId}:`,
        err,
      );
    }
    return null;
  }

  if (type === "wuu") {
    return path.join(cwd, ".wuu", "sessions", sessionId + ".jsonl");
  }

  if (type === "kimi") {
    return resolveKimiSessionFile(sessionId, cwd);
  }

  return null;
}

export function parseSessionTelemetryLine(
  line: string,
  type: SessionType,
): NormalizedSessionTelemetryEvent[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  const at = getString(parsed.timestamp) ?? getString(parsed.at);

  if (type === "claude") {
    const events: NormalizedSessionTelemetryEvent[] = [];
    if (parsed.type === "assistant") {
      const message = getObject(parsed.message);
      const stopReason = message?.stop_reason;
      const content = Array.isArray(message?.content) ? message?.content : [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const entry = block as Record<string, unknown>;
        if (entry.type === "thinking") {
          events.push(
            buildEvent({
              at,
              event_type: "thinking",
              role: "assistant",
              turn_state: "thinking",
              meaningful_progress: true,
            }),
          );
          continue;
        }
        if (entry.type === "tool_use") {
          events.push(
            buildEvent({
              at,
              event_type: "tool_use",
              role: "assistant",
              tool_name:
                typeof entry.name === "string" ? entry.name : undefined,
              turn_state: "tool_running",
              meaningful_progress: true,
            }),
          );
          continue;
        }
        const text =
          typeof entry.text === "string"
            ? entry.text
            : typeof entry.content === "string"
              ? entry.content
              : "";
        if (text.trim().length > 0) {
          events.push(
            buildEvent({
              at,
              event_type: "assistant_message",
              role: "assistant",
              turn_state: "in_turn",
              meaningful_progress: true,
            }),
          );
        }
      }

      if (
        events.length === 0 &&
        extractTextContent(message?.content).trim().length > 0
      ) {
        events.push(
          buildEvent({
            at,
            event_type: "assistant_message",
            role: "assistant",
            turn_state: "in_turn",
            meaningful_progress: true,
          }),
        );
      }

      const stopState = buildClaudeStopReasonState(stopReason);
      if (stopState) {
        events.push(
          buildEvent({
            at,
            event_type:
              stopState === "turn_complete"
                ? "turn_complete"
                : "assistant_stop",
            event_subtype:
              typeof stopReason === "string" ? stopReason : undefined,
            role: "assistant",
            turn_state: stopState,
            meaningful_progress: stopState === "turn_complete",
          }),
        );
      }
      return events;
    }

    if (parsed.type === "user") {
      const message = getObject(parsed.message);
      const content = Array.isArray(message?.content) ? message?.content : [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const entry = block as Record<string, unknown>;
        if (entry.type !== "tool_result") continue;
        const toolUseResult = getObject(parsed.toolUseResult);
        events.push(
          buildEvent({
            at,
            event_type: "tool_result",
            role: "user",
            event_subtype:
              typeof toolUseResult?.status === "string"
                ? toolUseResult.status
                : undefined,
            turn_state:
              toolUseResult?.status === "async_launched"
                ? "tool_running"
                : "in_turn",
            meaningful_progress: true,
          }),
        );
      }
      return events;
    }

    if (parsed.type === "system" && parsed.subtype === "turn_duration") {
      return [
        buildEvent({
          at,
          event_type: "turn_complete",
          event_subtype: "turn_duration",
          role: "system",
          turn_state: "turn_complete",
          meaningful_progress: true,
        }),
      ];
    }

    if (parsed.type === "queue-operation") {
      return [
        buildEvent({
          at,
          event_type: "queue_operation",
          role: "system",
          meaningful_progress: true,
        }),
      ];
    }

    if (parsed.type === "progress") {
      return [
        buildEvent({
          at,
          event_type: "progress",
          role: "system",
        }),
      ];
    }

    return [];
  }

  if (type === "wuu") {
    const role = getString(parsed.role);
    if (role === "user") {
      const text = extractTextContent(parsed.content);
      if (!text.trim()) return [];
      return [
        buildEvent({
          at,
          event_type: "user_message",
          role: "user",
          turn_state: "in_turn",
        }),
      ];
    }

    if (role === "assistant") {
      const events: NormalizedSessionTelemetryEvent[] = [];
      const toolCalls = Array.isArray(parsed.tool_calls)
        ? parsed.tool_calls
        : [];

      for (const callEntry of toolCalls) {
        const call = getObject(callEntry);
        if (!call) continue;
        events.push(
          buildEvent({
            at,
            event_type: "tool_use",
            role: "assistant",
            tool_name: getString(call.name),
            call_id: getString(call.id),
            lifecycle: "start",
            turn_state: "tool_running",
            meaningful_progress: true,
          }),
        );
      }

      const text = extractTextContent(parsed.content);
      if (text.trim()) {
        events.push(
          buildEvent({
            at,
            event_type: "assistant_message",
            role: "assistant",
            turn_state: "turn_complete",
            meaningful_progress: true,
          }),
        );
      }

      return events;
    }

    if (role === "tool") {
      return [
        buildEvent({
          at,
          event_type: "tool_result",
          role: "tool",
          tool_name: getString(parsed.name),
          call_id: getString(parsed.tool_call_id),
          lifecycle: "end",
          turn_state: "in_turn",
          meaningful_progress: true,
        }),
      ];
    }

    if (role === "system") {
      const content = extractTextContent(parsed.content).trim();
      if (!content) return [];
      let eventType = "system_message";
      if (content.includes("worker spawned")) {
        eventType = "worker_spawned";
      } else if (content.includes("worker completed")) {
        eventType = "worker_completed";
      } else if (content.includes("worker failed")) {
        eventType = "worker_failed";
      }
      return [
        buildEvent({
          at,
          event_type: eventType,
          role: "system",
          meaningful_progress: true,
        }),
      ];
    }

    return [];
  }

  if (type === "kimi") {
    const role = getString(parsed.role);
    if (role === "user") {
      const text = extractTextContent(parsed.content);
      if (!text.trim()) return [];
      return [
        buildEvent({
          at,
          event_type: "user_message",
          role: "user",
          turn_state: "in_turn",
        }),
      ];
    }

    if (role === "assistant") {
      const events: NormalizedSessionTelemetryEvent[] = [];
      const toolCalls = Array.isArray(parsed.tool_calls)
        ? parsed.tool_calls
        : [];

      for (const callEntry of toolCalls) {
        const call = getObject(callEntry);
        if (!call) continue;
        // call.function is unknown — need to narrow to a record
        // before reaching for `.name`, otherwise TS balks.
        const fn = getObject(call.function);
        events.push(
          buildEvent({
            at,
            event_type: "tool_use",
            role: "assistant",
            tool_name: getString(fn?.name) ?? getString(call.name),
            call_id: getString(call.id),
            lifecycle: "start",
            turn_state: "tool_running",
            meaningful_progress: true,
          }),
        );
      }

      const text = extractTextContent(parsed.content);
      if (text.trim()) {
        events.push(
          buildEvent({
            at,
            event_type: "assistant_message",
            role: "assistant",
            turn_state: toolCalls.length > 0 ? "in_turn" : "turn_complete",
            meaningful_progress: true,
          }),
        );
      }

      return events;
    }

    if (role === "tool") {
      return [
        buildEvent({
          at,
          event_type: "tool_result",
          role: "tool",
          tool_name: getString(parsed.name),
          call_id: getString(parsed.tool_call_id),
          lifecycle: "end",
          turn_state: "in_turn",
          meaningful_progress: true,
        }),
      ];
    }

    return [];
  }

  const payload = getObject(parsed.payload);
  if (!payload) return [];

  if (parsed.type === "event_msg") {
    const payloadType = getString(payload.type);
    const payloadCallId = getString(payload.call_id);

    if (payloadType === "task_started" || payloadType === "turn_started") {
      return [
        buildEvent({
          at,
          event_type: payloadType,
          turn_state: "in_turn",
        }),
      ];
    }
    if (payloadType === "task_complete" || payloadType === "turn_complete") {
      return [
        buildEvent({
          at,
          event_type: payloadType,
          turn_state: "turn_complete",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "turn_aborted") {
      return [
        buildEvent({
          at,
          event_type: "turn_aborted",
          event_subtype: getString(payload.reason),
          turn_state: "turn_aborted",
        }),
      ];
    }
    if (payloadType === "agent_message") {
      return [
        buildEvent({
          at,
          event_type: "agent_message",
          role: "assistant",
          turn_state: "in_turn",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "user_message") {
      return [
        buildEvent({
          at,
          event_type: "user_message",
          role: "user",
          turn_state: "in_turn",
        }),
      ];
    }
    if (payloadType === "token_count") {
      const info = getObject(payload.info);
      const totals = getObject(info?.total_token_usage);
      const tokenTotal =
        (typeof totals?.input_tokens === "number" ? totals.input_tokens : 0) +
        (typeof totals?.output_tokens === "number" ? totals.output_tokens : 0) +
        (typeof totals?.cached_input_tokens === "number"
          ? totals.cached_input_tokens
          : 0) +
        (typeof totals?.reasoning_output_tokens === "number"
          ? totals.reasoning_output_tokens
          : 0);
      return [
        buildEvent({
          at,
          event_type: "token_count",
          token_total: tokenTotal,
          turn_state: "in_turn",
        }),
      ];
    }
    if (payloadType === "context_compacted") {
      return [
        buildEvent({
          at,
          event_type: "context_compacted",
        }),
      ];
    }
    if (payloadType === "exec_command_begin") {
      return [
        buildEvent({
          at,
          event_type: "exec_command_begin",
          event_subtype: getString(payload.status),
          tool_name: "exec_command",
          call_id: payloadCallId,
          lifecycle: "start",
          turn_state: "tool_running",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "exec_command_end") {
      const status = getString(payload.status);
      return [
        buildEvent({
          at,
          event_type: "exec_command_end",
          event_subtype: status,
          tool_name: "exec_command",
          call_id: payloadCallId,
          lifecycle: "end",
          turn_state: status === "in_progress" ? "tool_running" : "in_turn",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "patch_apply_begin") {
      return [
        buildEvent({
          at,
          event_type: "patch_apply_begin",
          event_subtype: getString(payload.status),
          tool_name: "apply_patch",
          call_id: payloadCallId,
          lifecycle: "start",
          turn_state: "tool_running",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "patch_apply_end") {
      return [
        buildEvent({
          at,
          event_type: "patch_apply_end",
          event_subtype: getString(payload.status),
          tool_name: "apply_patch",
          call_id: payloadCallId,
          lifecycle: "end",
          turn_state: "in_turn",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "web_search_begin") {
      return [
        buildEvent({
          at,
          event_type: "web_search_begin",
          tool_name: "web_search",
          call_id: payloadCallId,
          lifecycle: "start",
          turn_state: "tool_running",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "web_search_end") {
      return [
        buildEvent({
          at,
          event_type: "web_search_end",
          tool_name: "web_search",
          call_id: payloadCallId,
          lifecycle: "end",
          turn_state: "in_turn",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "mcp_tool_call_begin") {
      const invocation = getObject(payload.invocation);
      const toolName =
        getString(invocation?.tool) ??
        getString(payload.tool_name) ??
        "mcp_tool";
      return [
        buildEvent({
          at,
          event_type: "mcp_tool_call_begin",
          tool_name: toolName,
          call_id: payloadCallId,
          lifecycle: "start",
          turn_state: "tool_running",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "mcp_tool_call_end") {
      const invocation = getObject(payload.invocation);
      const toolName =
        getString(invocation?.tool) ??
        getString(payload.tool_name) ??
        "mcp_tool";
      return [
        buildEvent({
          at,
          event_type: "mcp_tool_call_end",
          tool_name: toolName,
          call_id: payloadCallId,
          lifecycle: "end",
          turn_state: "in_turn",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "error") {
      return [
        buildEvent({
          at,
          event_type: "error",
          event_subtype: getString(payload.codex_error_info),
          turn_state: "in_turn",
          meaningful_progress: true,
        }),
      ];
    }
    return [];
  }

  if (parsed.type === "response_item") {
    const payloadType = getString(payload.type);
    const payloadCallId = getString(payload.call_id);

    if (payloadType === "reasoning") {
      return [
        buildEvent({
          at,
          event_type: "reasoning",
          role: "assistant",
          turn_state: "thinking",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      return [
        buildEvent({
          at,
          event_type: payloadType,
          tool_name: getString(payload.name),
          call_id: payloadCallId,
          lifecycle: "start",
          turn_state: "tool_running",
          meaningful_progress: true,
        }),
      ];
    }
    if (
      payloadType === "function_call_output" ||
      payloadType === "custom_tool_call_output"
    ) {
      return [
        buildEvent({
          at,
          event_type: payloadType,
          call_id: payloadCallId,
          lifecycle: "end",
          turn_state: "in_turn",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "web_search_call") {
      const status = getString(payload.status);
      return [
        buildEvent({
          at,
          event_type: "web_search_call",
          tool_name: "web_search",
          turn_state: status === "completed" ? "in_turn" : "tool_running",
          meaningful_progress: true,
        }),
      ];
    }
    if (payloadType === "message") {
      const role =
        payload.role === "assistant" || payload.role === "user"
          ? payload.role
          : undefined;
      return [
        buildEvent({
          at,
          event_type: "message",
          role,
          turn_state: role === "assistant" ? "in_turn" : undefined,
          meaningful_progress: role === "assistant",
        }),
      ];
    }
    return [];
  }

  if (parsed.type === "compacted") {
    return [buildEvent({ at, event_type: "compacted" })];
  }

  return [];
}

interface WatchEntry {
  watcher: fs.FSWatcher;
  filePath: string;
  lastNotifiedMtime: number;
  debounceTimer: NodeJS.Timeout | null;
  pollTimer: NodeJS.Timeout | null;
}

/**
 * Watches AI CLI session JSONL files for turn-completion signals.
 * Uses fs.watch on the parent directory + mtime verification (same pattern as GitFileWatcher).
 */
export class SessionWatcher {
  private entries = new Map<string, WatchEntry>();

  watch(
    sessionId: string,
    type: SessionType,
    cwd: string,
    callback: () => void,
  ): { ok: boolean; reason?: string } {
    if (this.entries.has(sessionId)) return { ok: true };

    const filePath = resolveSessionFile(sessionId, type, cwd);
    if (!filePath) {
      console.warn(
        `[SessionWatcher] resolveSessionFile returned null for session=${sessionId} type=${type} cwd=${cwd}`,
      );
      return { ok: false, reason: "session-file-not-found" };
    }

    if (isDev)
      console.log(
        `[SessionWatcher] watch session=${sessionId} type=${type} file=${filePath}`,
      );

    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);

    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.error(
          `[SessionWatcher] failed to create directory ${dir}:`,
          err,
        );
        return { ok: false, reason: "dir-create-failed" };
      }
    }

    let lastNotifiedMtime = 0;
    try {
      lastNotifiedMtime = fs.statSync(filePath).mtimeMs;
    } catch {}

    let debounceTimer: NodeJS.Timeout | null = null;
    let awaitingNewTurn = false;

    const tryCheck = (source: string): boolean => {
      let currentMtime = 0;
      try {
        currentMtime = fs.statSync(filePath).mtimeMs;
      } catch {
        return false;
      }

      const entry = this.entries.get(sessionId);
      if (!entry || currentMtime === entry.lastNotifiedMtime) return false;

      // Always update mtime to avoid re-checking the same file state
      entry.lastNotifiedMtime = currentMtime;

      const result = checkTurnComplete(filePath, type);
      if (isDev)
        console.log(
          `[SessionWatcher] checkTurnComplete source=${source} session=${sessionId} completed=${result.completed} awaitingNewTurn=${awaitingNewTurn}`,
        );
      if (result.completed) {
        if (!awaitingNewTurn) {
          awaitingNewTurn = true;
          if (isDev)
            console.log(`[SessionWatcher] completed session=${sessionId}`);
          callback();
          return true;
        }
      } else {
        // New turn started — the old completion is no longer in the tail
        awaitingNewTurn = false;
      }
      return false;
    };

    const watcher = fs.watch(dir, (event, changedFile) => {
      if (changedFile && changedFile !== basename) return;

      if (isDev)
        console.log(
          `[SessionWatcher] fs.watch event=${event} file=${changedFile} session=${sessionId}`,
        );

      let newMtime = 0;
      try {
        newMtime = fs.statSync(filePath).mtimeMs;
      } catch {
        return;
      }

      const entry = this.entries.get(sessionId);
      if (!entry) return;
      if (newMtime === entry.lastNotifiedMtime) return;

      // Debounce: JSONL may get multiple rapid writes per turn
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        tryCheck("fs.watch");
      }, 300);
    });

    // Fallback polling: fs.watch on macOS can miss events (rename from atomic writes).
    // Hooks are the primary turn-completion signal; this is a safety net.
    const POLL_DELAY = 60_000;
    const POLL_INTERVAL = 30_000;
    const pollTimer = setTimeout(() => {
      const entry = this.entries.get(sessionId);
      if (!entry) return;

      if (isDev)
        console.log(
          `[SessionWatcher] starting fallback polling for session=${sessionId}`,
        );
      entry.pollTimer = setInterval(() => {
        if (!this.entries.has(sessionId)) {
          const e = this.entries.get(sessionId);
          if (e?.pollTimer) clearInterval(e.pollTimer);
          return;
        }
        tryCheck("poll");
      }, POLL_INTERVAL);
    }, POLL_DELAY);

    this.entries.set(sessionId, {
      watcher,
      filePath,
      lastNotifiedMtime,
      debounceTimer,
      pollTimer,
    });

    // Mark awaitingNewTurn so we don't re-fire for the same completion, but
    // still fire the callback so the renderer knows the current state.
    if (lastNotifiedMtime > 0) {
      const result = checkTurnComplete(filePath, type);
      if (result.completed) {
        if (isDev)
          console.log(
            `[SessionWatcher] initial check: already completed session=${sessionId}`,
          );
        awaitingNewTurn = true;
        callback();
      }
    }

    return { ok: true };
  }

  unwatch(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    if (isDev) console.log(`[SessionWatcher] unwatch session=${sessionId}`);
    entry.watcher.close();
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    if (entry.pollTimer) {
      clearTimeout(entry.pollTimer);
      clearInterval(entry.pollTimer);
    }
    this.entries.delete(sessionId);
  }

  unwatchAll(): void {
    for (const sessionId of [...this.entries.keys()]) {
      this.unwatch(sessionId);
    }
  }
}
