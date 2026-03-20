import { readFile, writeFile, appendFile, unlink, access } from "fs/promises";
import path from "path";
import { TERMCANVAS_DIR } from "./state-persistence";
import { getSupabase, getAuthUser, getDeviceId, isLoggedIn } from "./auth";
import {
  parseClaudeSession,
  parseCodexSession,
  findClaudeJsonlFiles,
  findCodexJsonlFiles,
  computeCost,
  getLocalTzOffsetHours,
  type UsageRecord,
  type UsageSummary,
  type UsageBucket,
  type ProjectUsage,
  type ModelUsage,
} from "./usage-collector";

// ── Constants ─────────────────────────────────────────────────────────

const PREFIX = "[UsageSync]";
const SYNC_QUEUE_FILE = path.join(TERMCANVAS_DIR, "sync-queue.jsonl");
const BACKFILL_FLAG = path.join(TERMCANVAS_DIR, "sync-backfilled");
const BATCH_SIZE = 500;

// ── Types ─────────────────────────────────────────────────────────────

interface SyncRecord {
  model: string;
  project: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_5m_tokens: number;
  cache_create_1h_tokens: number;
  cost_usd: number;
  recorded_at: string; // ISO timestamp
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

// ── Internal helpers ──────────────────────────────────────────────────

async function uploadRecord(record: SyncRecord): Promise<void> {
  const supabase = getSupabase();
  const user = getAuthUser();
  if (!supabase || !user) throw new Error("Not authenticated");

  const { error } = await supabase.from("usage_records").insert({
    user_id: user.id,
    device_id: getDeviceId(),
    model: record.model,
    project: record.project || null,
    input_tokens: record.input_tokens,
    output_tokens: record.output_tokens,
    cost_usd: record.cost_usd,
    recorded_at: record.recorded_at,
  });

  if (error) throw error;
}

async function appendToQueue(record: SyncRecord): Promise<void> {
  try {
    await appendFile(SYNC_QUEUE_FILE, JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    console.error(PREFIX, "Failed to write to sync queue:", err);
  }
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

// ── Public API ────────────────────────────────────────────────────────

/**
 * Upload a single usage record to Supabase.
 * If not logged in or upload fails, queue to offline sync file.
 */
export async function syncUsageRecord(record: SyncRecord): Promise<void> {
  if (!isLoggedIn()) {
    await appendToQueue(record);
    return;
  }

  try {
    await uploadRecord(record);
  } catch (err) {
    console.error(PREFIX, "Upload failed, queuing:", err);
    await appendToQueue(record);
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
    return; // No queue file
  }

  const lines = content.split("\n").filter(Boolean);
  if (lines.length === 0) return;

  const failed: string[] = [];

  for (const line of lines) {
    try {
      const record: SyncRecord = JSON.parse(line);
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

  // Check if already backfilled
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

  // Wide UTC range to capture all history
  const utcStart = "2020-01-01T00:00:00";
  const utcEnd = new Date().toISOString().replace("Z", "").split(".")[0];

  const allRecords: UsageRecord[] = [];

  // Collect from Claude session files
  for (const f of findClaudeJsonlFiles()) {
    try {
      const { records } = parseClaudeSession(f, utcStart, utcEnd);
      allRecords.push(...records);
    } catch {
      // Skip unreadable files
    }
  }

  // Collect from Codex session files
  for (const f of findCodexJsonlFiles()) {
    try {
      const { records } = parseCodexSession(f, utcStart, utcEnd);
      allRecords.push(...records);
    } catch {
      // Skip unreadable files
    }
  }

  if (allRecords.length === 0) {
    try {
      await writeFile(BACKFILL_FLAG, new Date().toISOString(), "utf-8");
    } catch { /* best-effort */ }
    return;
  }

  // Map to DB rows
  const rows = allRecords.map((r) => ({
    user_id: user.id,
    device_id: deviceId,
    model: r.model,
    project: r.projectPath || null,
    input_tokens: r.input,
    output_tokens: r.output,
    cost_usd: computeCost(r.model, r.input, r.output, r.cacheRead, r.cacheCreate5m, r.cacheCreate1h),
    recorded_at: r.ts + "Z",
  }));

  // Batch insert, yielding between batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise<void>((r) => setImmediate(r));

    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await supabase.from("usage_records").insert(batch);
      if (error) {
        console.error(PREFIX, `Backfill batch ${i}-${i + batch.length} failed:`, error.message);
      }
    } catch (err) {
      console.error(PREFIX, `Backfill batch ${i}-${i + batch.length} error:`, err);
    }
  }

  // Mark as complete
  try {
    await writeFile(BACKFILL_FLAG, new Date().toISOString(), "utf-8");
    console.log(PREFIX, `Backfill complete: ${allRecords.length} records`);
  } catch (err) {
    console.error(PREFIX, "Failed to write backfill flag:", err);
  }
}

/**
 * Query usage data from Supabase for the logged-in user (all devices).
 * Returns data in CloudUsageSummary format (UsageSummary + devices breakdown).
 * Returns null if not logged in or query fails.
 */
export async function queryCloudUsage(dateStr: string): Promise<CloudUsageSummary | null> {
  if (!isLoggedIn()) return null;

  const supabase = getSupabase();
  const user = getAuthUser();
  if (!supabase || !user) return null;

  // Convert local date to UTC range
  const startMs = new Date(`${dateStr}T00:00:00`).getTime();
  const endMs = startMs + 86_400_000;
  const utcStart = new Date(startMs).toISOString();
  const utcEnd = new Date(endMs).toISOString();

  try {
    const { data, error } = await supabase
      .from("usage_records")
      .select("*")
      .eq("user_id", user.id)
      .gte("recorded_at", utcStart)
      .lt("recorded_at", utcEnd);

    if (error) {
      console.error(PREFIX, "Cloud usage query failed:", error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return {
        date: dateStr,
        sessions: 0,
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        totalCacheCreate5m: 0,
        totalCacheCreate1h: 0,
        totalCost: 0,
        buckets: createEmptyBuckets(2),
        projects: [],
        models: [],
        devices: [],
      };
    }

    // Aggregate
    const tzOffsetHours = getLocalTzOffsetHours();
    const intervalHours = 2;
    const buckets = createEmptyBuckets(intervalHours);
    const bucketCount = buckets.length;

    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    const projectMap = new Map<string, ProjectUsage>();
    const modelMap = new Map<string, ModelUsage>();
    const deviceMap = new Map<string, DeviceUsage>();
    const currentDeviceId = getDeviceId();

    for (const row of data) {
      const input = (row.input_tokens as number) ?? 0;
      const output = (row.output_tokens as number) ?? 0;
      const cost = Number(row.cost_usd) || 0;

      totalInput += input;
      totalOutput += output;
      totalCost += cost;

      // Bucket by local hour
      const utcMs = new Date(row.recorded_at as string).getTime();
      const localMs = utcMs + tzOffsetHours * 3_600_000;
      const localHour = new Date(localMs).getUTCHours();
      const bucketIdx = Math.floor(localHour / intervalHours);
      if (bucketIdx >= 0 && bucketIdx < bucketCount) {
        const b = buckets[bucketIdx];
        b.input += input;
        b.output += output;
        b.cost += cost;
        b.calls++;
      }

      // Project
      const pKey = (row.project as string) || "unknown";
      if (!projectMap.has(pKey)) {
        const name = pKey === "unknown" ? "Other" : path.basename(pKey);
        projectMap.set(pKey, {
          path: pKey, name, input: 0, output: 0,
          cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0, cost: 0, calls: 0,
        });
      }
      const proj = projectMap.get(pKey)!;
      proj.input += input;
      proj.output += output;
      proj.cost += cost;
      proj.calls++;

      // Model
      const model = row.model as string;
      if (!modelMap.has(model)) {
        modelMap.set(model, {
          model, input: 0, output: 0,
          cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0, cost: 0, calls: 0,
        });
      }
      const mod = modelMap.get(model)!;
      mod.input += input;
      mod.output += output;
      mod.cost += cost;
      mod.calls++;

      // Device
      const did = row.device_id as string;
      if (!deviceMap.has(did)) {
        deviceMap.set(did, {
          deviceId: did,
          isCurrentDevice: did === currentDeviceId,
          input: 0, output: 0, cost: 0, calls: 0,
        });
      }
      const dev = deviceMap.get(did)!;
      dev.input += input;
      dev.output += output;
      dev.cost += cost;
      dev.calls++;
    }

    return {
      date: dateStr,
      sessions: data.length,
      totalInput,
      totalOutput,
      totalCacheRead: 0,
      totalCacheCreate5m: 0,
      totalCacheCreate1h: 0,
      totalCost,
      buckets,
      projects: [...projectMap.values()].sort((a, b) => b.cost - a.cost),
      models: [...modelMap.values()].sort((a, b) => b.cost - a.cost),
      devices: [...deviceMap.values()].sort((a, b) => b.cost - a.cost),
    };
  } catch (err) {
    console.error(PREFIX, "Cloud usage query error:", err);
    return null;
  }
}

/**
 * Query cloud heatmap data (all devices, last 91 days).
 * Returns null if not logged in or query fails.
 */
export async function queryCloudHeatmap(): Promise<Record<string, { tokens: number; cost: number }> | null> {
  if (!isLoggedIn()) return null;

  const supabase = getSupabase();
  const user = getAuthUser();
  if (!supabase || !user) return null;

  const HEATMAP_DAYS = 91;
  const today = new Date();
  const startLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (HEATMAP_DAYS - 1));
  const utcStart = new Date(startLocal.getTime()).toISOString();

  try {
    const { data, error } = await supabase
      .from("usage_records")
      .select("input_tokens, output_tokens, cost_usd, recorded_at")
      .eq("user_id", user.id)
      .gte("recorded_at", utcStart);

    if (error) {
      console.error(PREFIX, "Cloud heatmap query failed:", error.message);
      return null;
    }

    if (!data || data.length === 0) return {};

    const tzOffsetHours = getLocalTzOffsetHours();
    const result: Record<string, { tokens: number; cost: number }> = {};

    for (const row of data) {
      const utcMs = new Date(row.recorded_at as string).getTime();
      const localMs = utcMs + tzOffsetHours * 3_600_000;
      const localDate = new Date(localMs);
      const dateStr = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, "0")}-${String(localDate.getUTCDate()).padStart(2, "0")}`;

      const tokens = ((row.input_tokens as number) ?? 0) + ((row.output_tokens as number) ?? 0);
      const cost = Number(row.cost_usd) || 0;

      if (!result[dateStr]) {
        result[dateStr] = { tokens: 0, cost: 0 };
      }
      result[dateStr].tokens += tokens;
      result[dateStr].cost += cost;
    }

    return result;
  } catch (err) {
    console.error(PREFIX, "Cloud heatmap query error:", err);
    return null;
  }
}
