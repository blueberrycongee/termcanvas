import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type {
  NormalizedSessionTelemetryEvent,
  TelemetryProvider,
} from "../shared/telemetry.ts";

export interface OpenCodeFoundSession {
  sessionId: string;
  filePath: string;
  confidence: "strong" | "medium" | "weak";
}

export interface OpenCodeTelemetryRead {
  events: NormalizedSessionTelemetryEvent[];
  eventKeys: string[];
  firstUserPrompt?: string;
}

interface SqliteStatement {
  all(...params: unknown[]): unknown;
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

interface OpenCodeSessionRow {
  id?: string;
  project_id?: string;
  directory?: string;
  time_created?: number;
  time_updated?: number;
}

interface OpenCodeMessageRow {
  id?: string;
  session_id?: string;
  time_created?: number;
  time_updated?: number;
  data?: string;
}

interface OpenCodePartRow {
  id?: string;
  message_id?: string;
  session_id?: string;
  time_created?: number;
  time_updated?: number;
  data?: string;
  message_data?: string;
}

const require = createRequire(import.meta.url);
const OPEN_CODE_EVENT_LIMIT = 500;
const FIRST_PROMPT_MAX_LENGTH = 100;

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

export function getOpenCodeDataDir(homeDir = os.homedir()): string {
  const xdgData = process.env.XDG_DATA_HOME ?? path.join(homeDir, ".local", "share");
  return path.join(xdgData, "opencode");
}

export function getOpenCodeDbPath(homeDir = os.homedir()): string {
  return path.join(getOpenCodeDataDir(homeDir), "opencode.db");
}

function withOpenCodeDb<T>(
  dbPath: string,
  callback: (db: SqliteDatabase) => T,
): T | null {
  const DatabaseSync = getDatabaseSyncCtor();
  if (!DatabaseSync || !fs.existsSync(dbPath)) return null;

  let db: SqliteDatabase | null = null;
  try {
    db = new DatabaseSync(dbPath, { readonly: true });
    return callback(db);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function safeParseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
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

function toIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Date(value).toISOString();
}

function collapseAndTruncate(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function textFromOpenCodePart(part: Record<string, unknown>): string {
  return typeof part.text === "string" ? part.text : "";
}

function buildEvent(
  event: Omit<NormalizedSessionTelemetryEvent, "at"> & { at?: string },
): NormalizedSessionTelemetryEvent {
  return {
    meaningful_progress: false,
    ...event,
  };
}

function eventFromOpenCodeMessage(
  row: OpenCodeMessageRow,
  message: Record<string, unknown>,
): NormalizedSessionTelemetryEvent[] {
  const role = getString(message.role);
  if (role !== "assistant") return [];

  const finish = getString(message.finish);
  const error = getObject(message.error);
  if (error) {
    return [
      buildEvent({
        at: toIso(row.time_updated ?? row.time_created),
        event_type: "error",
        role: "assistant",
        event_subtype: getString(error.name) ?? getString(error.message),
        turn_state: "turn_aborted",
        meaningful_progress: true,
      }),
    ];
  }

  if (!finish) return [];
  if (finish !== "stop") {
    return [
      buildEvent({
        at: toIso(row.time_updated ?? row.time_created),
        event_type: "assistant_step",
        event_subtype: finish,
        role: "assistant",
        turn_state: "in_turn",
        meaningful_progress: true,
      }),
    ];
  }

  return [
    buildEvent({
      at: toIso(row.time_updated ?? row.time_created),
      event_type: "turn_complete",
      event_subtype: finish,
      role: "assistant",
      turn_state: "turn_complete",
      meaningful_progress: true,
    }),
  ];
}

function eventFromOpenCodePart(
  row: OpenCodePartRow,
  part: Record<string, unknown>,
  message: Record<string, unknown> | null,
): NormalizedSessionTelemetryEvent[] {
  const type = getString(part.type);
  const role = getString(message?.role);
  const at = toIso(row.time_updated ?? row.time_created);

  if (role === "user" && type === "text" && textFromOpenCodePart(part).trim()) {
    return [
      buildEvent({
        at,
        event_type: "user_message",
        role: "user",
        turn_state: "in_turn",
      }),
    ];
  }

  if (role !== "assistant") return [];

  if (type === "reasoning") {
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

  if (type === "text" && textFromOpenCodePart(part).trim()) {
    return [
      buildEvent({
        at,
        event_type: "assistant_message",
        role: "assistant",
        turn_state: "in_turn",
        meaningful_progress: true,
      }),
    ];
  }

  if (type === "tool") {
    const state = getObject(part.state);
    const status = getString(state?.status);
    const toolName = getString(part.tool) ?? getString(part.name) ?? "tool";
    const callId = getString(part.id);
    if (status === "pending" || status === "running") {
      return [
        buildEvent({
          at,
          event_type: "tool_use",
          event_subtype: status,
          role: "assistant",
          tool_name: toolName,
          call_id: callId,
          lifecycle: "start",
          turn_state: "tool_running",
          meaningful_progress: true,
        }),
      ];
    }
    if (status === "completed" || status === "error") {
      return [
        buildEvent({
          at,
          event_type: "tool_result",
          event_subtype: status,
          role: "tool",
          tool_name: toolName,
          call_id: callId,
          lifecycle: "end",
          turn_state: status === "error" ? "turn_aborted" : "in_turn",
          meaningful_progress: true,
        }),
      ];
    }
  }

  if (type === "step-start") {
    return [
      buildEvent({
        at,
        event_type: "step_start",
        role: "assistant",
        turn_state: "in_turn",
        meaningful_progress: true,
      }),
    ];
  }

  if (type === "step-finish") {
    return [
      buildEvent({
        at,
        event_type: "step_finish",
        event_subtype: getString(part.reason),
        role: "assistant",
        turn_state: "in_turn",
        meaningful_progress: true,
      }),
    ];
  }

  return [];
}

export function resolveOpenCodeSessionFile(
  sessionId: string,
  cwd: string,
  homeDir = os.homedir(),
): string | null {
  const dbPath = getOpenCodeDbPath(homeDir);
  return withOpenCodeDb(dbPath, (db) => {
    const row = db
      .prepare(
        `
        SELECT id, directory
        FROM session
        WHERE id = ?
        LIMIT 1
      `,
      )
      .get(sessionId) as OpenCodeSessionRow | undefined;
    if (!row?.id) return null;
    if (typeof row.directory === "string" && row.directory !== cwd) return null;
    return dbPath;
  });
}

export function findBestOpenCodeSession(
  cwd: string,
  startedAt?: string,
  homeDir = os.homedir(),
): OpenCodeFoundSession | null {
  const dbPath = getOpenCodeDbPath(homeDir);
  const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;

  return withOpenCodeDb(dbPath, (db) => {
    const rows = db
      .prepare(
        `
        SELECT id, directory, time_created, time_updated
        FROM session
        WHERE directory = ?
        ORDER BY time_updated DESC
        LIMIT 32
      `,
      )
      .all(cwd) as OpenCodeSessionRow[];

    const candidates = rows
      .map((row) => {
        if (typeof row.id !== "string" || row.id.length === 0) return null;
        const createdMs =
          typeof row.time_created === "number" ? row.time_created : 0;
        const updatedMs =
          typeof row.time_updated === "number" ? row.time_updated : createdMs;
        const activityMs = Math.max(createdMs, updatedMs);
        if (Number.isFinite(startedMs) && activityMs < startedMs - 1_000) {
          return null;
        }
        const anchorMs =
          Number.isFinite(startedMs) && createdMs < startedMs
            ? activityMs
            : createdMs || activityMs;
        const distance = Number.isFinite(startedMs)
          ? Math.abs(anchorMs - startedMs)
          : 0;
        return { sessionId: row.id, anchorMs, activityMs, distance };
      })
      .filter(
        (candidate): candidate is {
          sessionId: string;
          anchorMs: number;
          activityMs: number;
          distance: number;
        } => candidate !== null,
      )
      .sort((left, right) => {
        if (left.distance !== right.distance) {
          return left.distance - right.distance;
        }
        if (left.activityMs !== right.activityMs) {
          return right.activityMs - left.activityMs;
        }
        return right.anchorMs - left.anchorMs;
      });

    const match = candidates[0];
    if (!match) return null;
    return {
      sessionId: match.sessionId,
      filePath: dbPath,
      confidence: Number.isFinite(startedMs) ? "medium" : "weak",
    };
  });
}

export function extractOpenCodeFirstUserPrompt(
  dbPath: string,
  sessionId: string,
): string | undefined {
  return (
    withOpenCodeDb(dbPath, (db) => {
      const row = db
        .prepare(
          `
          SELECT part.data AS data
          FROM part
          JOIN message ON message.id = part.message_id
          WHERE part.session_id = ?
            AND json_extract(message.data, '$.role') = 'user'
            AND json_extract(part.data, '$.type') = 'text'
          ORDER BY part.time_created ASC, part.id ASC
          LIMIT 1
        `,
        )
        .get(sessionId) as { data?: string } | undefined;
      const part = safeParseObject(row?.data);
      const text = part ? textFromOpenCodePart(part) : "";
      return text ? collapseAndTruncate(text, FIRST_PROMPT_MAX_LENGTH) : undefined;
    }) ?? undefined
  );
}

export function readOpenCodeSessionTelemetry(
  input: {
    dbPath: string;
    sessionId: string;
    seenEventKeys: ReadonlySet<string>;
  },
): OpenCodeTelemetryRead {
  return (
    withOpenCodeDb(input.dbPath, (db) => {
      const messages = db
        .prepare(
          `
          SELECT id, session_id, time_created, time_updated, data
          FROM message
          WHERE session_id = ?
          ORDER BY time_updated DESC, id DESC
          LIMIT ?
        `,
        )
        .all(input.sessionId, OPEN_CODE_EVENT_LIMIT) as OpenCodeMessageRow[];
      const parts = db
        .prepare(
          `
          SELECT
            part.id,
            part.message_id,
            part.session_id,
            part.time_created,
            part.time_updated,
            part.data,
            message.data AS message_data
          FROM part
          JOIN message ON message.id = part.message_id
          WHERE part.session_id = ?
          ORDER BY part.time_updated DESC, part.id DESC
          LIMIT ?
        `,
        )
        .all(input.sessionId, OPEN_CODE_EVENT_LIMIT) as OpenCodePartRow[];

      const items = [
        ...messages.map((row) => ({ kind: "message" as const, row })),
        ...parts.map((row) => ({ kind: "part" as const, row })),
      ].sort((left, right) => {
        const leftTime = left.row.time_updated ?? left.row.time_created ?? 0;
        const rightTime = right.row.time_updated ?? right.row.time_created ?? 0;
        if (leftTime !== rightTime) return leftTime - rightTime;
        if (left.kind !== right.kind) return left.kind === "part" ? -1 : 1;
        return String(left.row.id ?? "").localeCompare(String(right.row.id ?? ""));
      });

      const events: NormalizedSessionTelemetryEvent[] = [];
      const eventKeys: string[] = [];

      for (const item of items) {
        const row = item.row;
        const part = item.kind === "part" ? safeParseObject(row.data) : null;
        const partState = part ? getObject(part.state) : null;
        const key = [
          item.kind,
          row.id ?? "",
          row.time_updated ?? row.time_created ?? 0,
          getString(partState?.status) ?? "",
        ].join(":");
        if (!row.id || input.seenEventKeys.has(key)) continue;

        let nextEvents: NormalizedSessionTelemetryEvent[] = [];
        if (item.kind === "message") {
          const message = safeParseObject(row.data);
          if (message) nextEvents = eventFromOpenCodeMessage(row, message);
        } else {
          const message = safeParseObject(row.message_data);
          if (part) nextEvents = eventFromOpenCodePart(row, part, message);
        }

        eventKeys.push(key);
        events.push(...nextEvents);
      }

      return {
        events,
        eventKeys,
        firstUserPrompt: extractOpenCodeFirstUserPrompt(input.dbPath, input.sessionId),
      };
    }) ?? { events: [], eventKeys: [] }
  );
}

export function isOpenCodeProvider(
  provider: TelemetryProvider,
): provider is "opencode" {
  return provider === "opencode";
}

export function checkOpenCodeTurnComplete(
  dbPath: string,
  sessionId: string,
): boolean {
  const read = readOpenCodeSessionTelemetry({
    dbPath,
    sessionId,
    seenEventKeys: new Set(),
  });
  for (let index = read.events.length - 1; index >= 0; index -= 1) {
    const event = read.events[index];
    if (event?.turn_state === "turn_complete") return true;
    if (
      event?.turn_state === "in_turn" ||
      event?.turn_state === "thinking" ||
      event?.turn_state === "tool_running" ||
      event?.turn_state === "tool_pending"
    ) {
      return false;
    }
  }
  return false;
}
