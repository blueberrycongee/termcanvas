import { readFile, writeFile, appendFile, unlink, access, stat } from "fs/promises";
import path from "path";
import { TERMCANVAS_DIR } from "./state-persistence";
import { getSupabase, getAuthUser, getDeviceId, isLoggedIn } from "./auth";
import { buildUsageRecordHash, type UsageRecordHashInput } from "./usage-record-hash";
import {
  parseClaudeSession,
  parseCodexSession,
  findClaudeJsonlFiles,
  findCodexJsonlFiles,
  computeCost,
  type UsageRecord,
  type UsageSummary,
  type UsageBucket,
} from "./usage-collector";

const PREFIX = "[UsageSync]";
const SYNC_QUEUE_FILE = path.join(TERMCANVAS_DIR, "sync-queue.jsonl");
const BACKFILL_FLAG = path.join(TERMCANVAS_DIR, "sync-backfilled");
const BATCH_SIZE = 500;
const RECENT_SYNC_YIELD_EVERY = 32;

let recentSyncInFlight: Promise<void> | null = null;

interface SyncRecord extends UsageRecordHashInput {
  record_hash?: string;
}

interface DeviceUsage {
  deviceId: string;
  isCurrentDevice: boolean;
  input: number;
  output: number;
  cost: number;
  calls: number;
}

export interface CloudUsageSummary extends UsageSummary {
  devices: DeviceUsage[];
}

interface RpcBucket {
  hourStart: number;
  input: number;
  output: number;
  cost: number;
  calls: number;
}

interface RpcItem {
  path?: string;
  model?: string;
  deviceId?: string;
  input: number;
  output: number;
  cost: number;
  calls: number;
}

interface RpcSummary {
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalCost: number;
  buckets: RpcBucket[];
  projects: RpcItem[];
  models: RpcItem[];
  devices: RpcItem[];
}

function getLocalTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function shouldScanByMtime(
  filePath: string,
  localStartDate: string,
): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    const mtimeLocalDate = toLocalDateString(fileStat.mtime);
    return mtimeLocalDate >= localStartDate;
  } catch {
    return false;
  }
}

function normalizeSyncRecord(record: SyncRecord): SyncRecord & { record_hash: string } {
  return {
    ...record,
    record_hash: record.record_hash ?? buildUsageRecordHash(record),
  };
}

function parseRpcPayload<T>(payload: T | string | null): T | null {
  if (!payload) return null;
  if (typeof payload === "string") {
    try { return JSON.parse(payload) as T; } catch { return null; }
  }
  return payload;
}

function createEmptyBuckets(intervalHours: number): UsageBucket[] {
  const bucketCount = 24 / intervalHours;
  return Array.from({ length: bucketCount }, (_, i) => {
    const h = i * intervalHours;
    return {
      label: `${String(h).padStart(2, "0")}:00-${String(h + intervalHours).padStart(2, "0")}:00`,
      hourStart: h,
      input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0, cost: 0, calls: 0,
    };
  });
}

function mergeBucketsWithDefaults(rpcBuckets: RpcBucket[] | undefined, intervalHours: number): UsageBucket[] {
  const buckets = createEmptyBuckets(intervalHours);
  if (!rpcBuckets) return buckets;
  const map = new Map(rpcBuckets.map((b) => [b.hourStart, b]));
  return buckets.map((b) => {
    const rb = map.get(b.hourStart);
    if (!rb) return b;
    return { ...b, input: Number(rb.input) || 0, output: Number(rb.output) || 0, cost: Number(rb.cost) || 0, calls: Number(rb.calls) || 0 };
  });
}

function createEmptyCloudSummary(dateStr: string): CloudUsageSummary {
  return {
    date: dateStr, sessions: 0, totalInput: 0, totalOutput: 0,
    totalCacheRead: 0, totalCacheCreate5m: 0, totalCacheCreate1h: 0, totalCost: 0,
    buckets: createEmptyBuckets(2), projects: [], models: [], devices: [],
  };
}

function mapUsageRecordToRow(userId: string, deviceId: string, record: UsageRecord) {
  const costUsd = computeCost(record.model, record.input, record.output, record.cacheRead, record.cacheCreate5m, record.cacheCreate1h);
  const syncRecord: SyncRecord = {
    model: record.model,
    project: record.projectPath || "",
    input_tokens: record.input,
    output_tokens: record.output,
    cache_read_tokens: record.cacheRead,
    cache_create_5m_tokens: record.cacheCreate5m,
    cache_create_1h_tokens: record.cacheCreate1h,
    cost_usd: costUsd,
    recorded_at: record.ts + "Z",
    source_id: record.msgId,
  };
  return {
    user_id: userId,
    device_id: deviceId,
    model: syncRecord.model,
    project: syncRecord.project || null,
    input_tokens: syncRecord.input_tokens,
    output_tokens: syncRecord.output_tokens,
    cost_usd: syncRecord.cost_usd,
    recorded_at: syncRecord.recorded_at,
    record_hash: buildUsageRecordHash(syncRecord),
  };
}

async function uploadRecord(record: SyncRecord): Promise<void> {
  const normalized = normalizeSyncRecord(record);
  const supabase = getSupabase();
  const user = getAuthUser();
  if (!supabase || !user) throw new Error("Not authenticated");

  const { error } = await supabase.from("usage_records").insert({
    user_id: user.id,
    device_id: getDeviceId(),
    model: normalized.model,
    project: normalized.project || null,
    input_tokens: normalized.input_tokens,
    output_tokens: normalized.output_tokens,
    cost_usd: normalized.cost_usd,
    recorded_at: normalized.recorded_at,
    record_hash: normalized.record_hash,
  });

  if (error) throw error;
}

async function appendToQueue(record: SyncRecord): Promise<void> {
  try {
    await appendFile(SYNC_QUEUE_FILE, JSON.stringify(normalizeSyncRecord(record)) + "\n", "utf-8");
  } catch (err) {
    console.error(PREFIX, "Failed to write to sync queue:", err);
  }
}

/**
 * Upload a single usage record to Supabase.
 * If not logged in or upload fails, queue to offline sync file.
 */
export async function syncUsageRecord(record: SyncRecord): Promise<void> {
  const normalized = normalizeSyncRecord(record);
  if (!isLoggedIn()) {
    await appendToQueue(normalized);
    return;
  }

  try {
    await uploadRecord(normalized);
  } catch (err) {
    console.error(PREFIX, "Upload failed, queuing:", err);
    await appendToQueue(normalized);
  }
}

/**
 * Process the offline queue (retry failed uploads).
 * Reads sync-queue.jsonl, attempts each record, keeps only failures.
 */
export async function flushSyncQueue(): Promise<void> {
  if (!isLoggedIn()) return;

  let content: string;
  try {
    content = await readFile(SYNC_QUEUE_FILE, "utf-8");
  } catch {
    return;
  }

  const lines = content.split("\n").filter(Boolean);
  if (lines.length === 0) return;

  const failed: string[] = [];

  for (const line of lines) {
    try {
      const record = normalizeSyncRecord(JSON.parse(line) as SyncRecord);
      await uploadRecord(record);
    } catch {
      failed.push(line);
    }
  }

  try {
    if (failed.length > 0) {
      await writeFile(SYNC_QUEUE_FILE, failed.join("\n") + "\n", "utf-8");
    } else {
      await unlink(SYNC_QUEUE_FILE);
    }
  } catch (err) {
    console.error(PREFIX, "Failed to update sync queue:", err);
  }
}

/**
 * One-time backfill: upload all existing local usage records to Supabase.
 * Uses ~/.termcanvas/sync-backfilled flag to avoid re-running.
 */
export async function backfillHistory(): Promise<void> {
  if (!isLoggedIn()) return;

  try {
    await access(BACKFILL_FLAG);
    return;
  } catch {
    // Flag doesn't exist — proceed with backfill
  }

  const supabase = getSupabase();
  const user = getAuthUser();
  if (!supabase || !user) return;

  const deviceId = getDeviceId();

  const utcStart = "2020-01-01T00:00:00";
  const utcEnd = new Date().toISOString().replace("Z", "").split(".")[0];

  const allRecords: UsageRecord[] = [];

  for (const f of findClaudeJsonlFiles()) {
    try {
      const { records } = parseClaudeSession(f, utcStart, utcEnd);
      allRecords.push(...records);
    } catch {
    }
  }

  for (const f of findCodexJsonlFiles()) {
    try {
      const { records } = parseCodexSession(f, utcStart, utcEnd);
      allRecords.push(...records);
    } catch {
    }
  }

  if (allRecords.length === 0) {
    try {
      await writeFile(BACKFILL_FLAG, new Date().toISOString(), "utf-8");
    } catch { /* best-effort */ }
    return;
  }

  const rows = allRecords.map((record) => mapUsageRecordToRow(user.id, deviceId, record));

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise<void>((r) => setImmediate(r));

    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await supabase.from("usage_records").upsert(batch, {
            onConflict: "user_id,device_id,record_hash",
            ignoreDuplicates: true,
          });
      if (error) {
        console.error(PREFIX, `Backfill batch ${i}-${i + batch.length} failed:`, error.message);
      }
    } catch (err) {
      console.error(PREFIX, `Backfill batch ${i}-${i + batch.length} error:`, err);
    }
  }

  try {
    await writeFile(BACKFILL_FLAG, new Date().toISOString(), "utf-8");
    console.log(PREFIX, `Backfill complete: ${allRecords.length} records`);
  } catch (err) {
    console.error(PREFIX, "Failed to write backfill flag:", err);
  }
}

/**
 * Incremental sync: upload recent usage records (last 2 days) to Supabase.
 * The unique constraint (user_id, device_id, record_hash) handles deduplication.
 */
export async function syncRecentRecords(): Promise<void> {
  if (recentSyncInFlight) return recentSyncInFlight;

  recentSyncInFlight = (async () => {
    if (!isLoggedIn()) return;

    const supabase = getSupabase();
    const user = getAuthUser();
    if (!supabase || !user) return;

    const deviceId = getDeviceId();

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // This avoids parsing years of immutable history every 5 minutes.
    const scanStartLocalDate = toLocalDateString(start);
    const fmt = (ms: number) => new Date(ms).toISOString().replace("Z", "").split(".")[0];
    const utcStart = fmt(start.getTime());
    const utcEnd = fmt(end.getTime());

    const allRecords: UsageRecord[] = [];

    const claudeFiles = findClaudeJsonlFiles();
    for (let i = 0; i < claudeFiles.length; i++) {
      if (i > 0 && i % RECENT_SYNC_YIELD_EVERY === 0) {
        await yieldToEventLoop();
      }
      const filePath = claudeFiles[i];
      if (!(await shouldScanByMtime(filePath, scanStartLocalDate))) continue;
      try {
        const { records } = parseClaudeSession(filePath, utcStart, utcEnd);
        allRecords.push(...records);
      } catch {
      }
    }

    const codexFiles = findCodexJsonlFiles();
    for (let i = 0; i < codexFiles.length; i++) {
      if (i > 0 && i % RECENT_SYNC_YIELD_EVERY === 0) {
        await yieldToEventLoop();
      }
      const filePath = codexFiles[i];
      if (!(await shouldScanByMtime(filePath, scanStartLocalDate))) continue;
      try {
        const { records } = parseCodexSession(filePath, utcStart, utcEnd);
        allRecords.push(...records);
      } catch {
      }
    }

    if (allRecords.length === 0) return;

    const rows = allRecords.map((record) =>
      mapUsageRecordToRow(user.id, deviceId, record),
    );

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      if (i > 0) await yieldToEventLoop();

      const batch = rows.slice(i, i + BATCH_SIZE);
      try {
        const { error } = await supabase.from("usage_records").upsert(batch, {
          onConflict: "user_id,device_id,record_hash",
          ignoreDuplicates: true,
        });
        if (error) {
          console.error(
            PREFIX,
            `Incremental sync batch ${i}-${i + batch.length} failed:`,
            error.message,
          );
        }
      } catch (err) {
        console.error(
          PREFIX,
          `Incremental sync batch ${i}-${i + batch.length} error:`,
          err,
        );
      }
    }
  })();

  try {
    await recentSyncInFlight;
  } finally {
    recentSyncInFlight = null;
  }
}

/**
 * Query usage data from Supabase for the logged-in user (all devices).
 * Uses server-side RPC aggregation to avoid PostgREST row limits.
 */
export async function queryCloudUsage(dateStr: string): Promise<CloudUsageSummary | null> {
  if (!isLoggedIn()) return null;

  const supabase = getSupabase();
  if (!supabase || !getAuthUser()) return null;

  const startMs = new Date(`${dateStr}T00:00:00`).getTime();
  const endMs = startMs + 86_400_000;
  const utcStart = new Date(startMs).toISOString();
  const utcEnd = new Date(endMs).toISOString();

  try {
    const { data, error } = await supabase.rpc("get_cloud_usage_summary", {
      p_utc_start: utcStart,
      p_utc_end: utcEnd,
      p_tz_offset_minutes: getLocalTzOffsetMinutes(),
      p_bucket_hours: 2,
    });

    if (error) {
      console.error(PREFIX, "Cloud usage query failed:", error.message);
      return null;
    }

    const payload = parseRpcPayload<RpcSummary>(data);
    if (!payload) return createEmptyCloudSummary(dateStr);

    const currentDeviceId = getDeviceId();

    return {
      date: dateStr,
      sessions: Number(payload.sessions) || 0,
      totalInput: Number(payload.totalInput) || 0,
      totalOutput: Number(payload.totalOutput) || 0,
      totalCacheRead: 0,
      totalCacheCreate5m: 0,
      totalCacheCreate1h: 0,
      totalCost: Number(payload.totalCost) || 0,
      buckets: mergeBucketsWithDefaults(payload.buckets, 2),
      projects: (payload.projects ?? []).map((p) => ({
        path: p.path || "unknown",
        name: (p.path && p.path !== "unknown") ? path.basename(p.path) : "Other",
        input: Number(p.input) || 0, output: Number(p.output) || 0,
        cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0,
        cost: Number(p.cost) || 0, calls: Number(p.calls) || 0,
      })),
      models: (payload.models ?? []).map((m) => ({
        model: m.model || "unknown",
        input: Number(m.input) || 0, output: Number(m.output) || 0,
        cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0,
        cost: Number(m.cost) || 0, calls: Number(m.calls) || 0,
      })),
      devices: (payload.devices ?? []).map((d) => ({
        deviceId: d.deviceId || "unknown",
        isCurrentDevice: d.deviceId === currentDeviceId,
        input: Number(d.input) || 0, output: Number(d.output) || 0,
        cost: Number(d.cost) || 0, calls: Number(d.calls) || 0,
      })),
    };
  } catch (err) {
    console.error(PREFIX, "Cloud usage query error:", err);
    return null;
  }
}

/**
 * Query cloud heatmap data (all devices, last 91 days).
 * Uses server-side RPC aggregation to avoid PostgREST row limits.
 */
export async function queryCloudHeatmap(): Promise<Record<string, { tokens: number; cost: number }> | null> {
  if (!isLoggedIn()) return null;

  const supabase = getSupabase();
  if (!supabase || !getAuthUser()) return null;

  const HEATMAP_DAYS = 91;
  const today = new Date();
  const startLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (HEATMAP_DAYS - 1));
  const utcStart = new Date(startLocal.getTime()).toISOString();

  try {
    const { data, error } = await supabase.rpc("get_cloud_usage_heatmap", {
      p_utc_start: utcStart,
      p_tz_offset_minutes: getLocalTzOffsetMinutes(),
    });

    if (error) {
      console.error(PREFIX, "Cloud heatmap query failed:", error.message);
      return null;
    }

    const payload = parseRpcPayload<Record<string, { tokens: number; cost: number }>>(data);
    if (!payload) return {};

    return Object.fromEntries(
      Object.entries(payload).map(([date, entry]) => [
        date,
        { tokens: Number(entry.tokens) || 0, cost: Number(entry.cost) || 0 },
      ]),
    );
  } catch (err) {
    console.error(PREFIX, "Cloud heatmap query error:", err);
    return null;
  }
}
