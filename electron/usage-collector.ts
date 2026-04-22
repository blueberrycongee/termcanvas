import fs from "fs";
import path from "path";
import os from "os";
import { TERMCANVAS_DIR } from "./state-persistence.ts";

interface Pricing {
  input: number;
  output: number;
  cache_read: number;
  cache_create_5m: number;
  cache_create_1h: number;
  long_context_threshold_tokens?: number;
  long_context_input_multiplier?: number;
  long_context_output_multiplier?: number;
}

function claudePricing(
  input: number,
  output: number,
  cacheRead: number,
  cacheCreate5m: number,
  cacheCreate1h: number,
): Pricing {
  return {
    input,
    output,
    cache_read: cacheRead,
    cache_create_5m: cacheCreate5m,
    cache_create_1h: cacheCreate1h,
  };
}

function openaiPricing(
  input: number,
  cacheRead: number,
  output: number,
  extras: Pick<
    Pricing,
    | "long_context_threshold_tokens"
    | "long_context_input_multiplier"
    | "long_context_output_multiplier"
  > = {},
): Pricing {
  return {
    input,
    output,
    cache_read: cacheRead,
    cache_create_5m: 0,
    cache_create_1h: 0,
    ...extras,
  };
}

const PRICING: Record<string, Pricing> = {
  "claude-opus-4-6": claudePricing(5.00, 25.00, 0.50, 6.25, 10.00),
  "claude-sonnet-4-6": claudePricing(3.00, 15.00, 0.30, 3.75, 6.00),
  "claude-haiku-4-5": claudePricing(1.00, 5.00, 0.10, 1.25, 2.00),
  "gpt-5.4": openaiPricing(2.50, 0.25, 15.00, {
    long_context_threshold_tokens: 272_000,
    long_context_input_multiplier: 2,
    long_context_output_multiplier: 1.5,
  }),
  "gpt-5.4-mini": openaiPricing(0.75, 0.075, 4.50),
  "gpt-5.4-nano": openaiPricing(0.20, 0.02, 1.25),
  "gpt-5.3-codex": openaiPricing(1.75, 0.175, 14.00),
  "gpt-5.2-codex": openaiPricing(1.75, 0.175, 14.00),
  "gpt-5.2": openaiPricing(1.75, 0.175, 14.00),
  "gpt-5.1-codex-mini": openaiPricing(0.25, 0.025, 2.00),
  "gpt-5.1-codex-max": openaiPricing(1.25, 0.125, 10.00),
  "gpt-5.1-codex": openaiPricing(1.25, 0.125, 10.00),
  "gpt-5.1": openaiPricing(1.25, 0.125, 10.00),
  "gpt-5-codex": openaiPricing(1.25, 0.125, 10.00),
  "gpt-5-mini": openaiPricing(0.25, 0.025, 2.00),
  "gpt-5-nano": openaiPricing(0.05, 0.005, 0.40),
  "gpt-5": openaiPricing(1.25, 0.125, 10.00),
  "gpt-4o-mini": openaiPricing(0.15, 0.075, 0.60),
  "gpt-4o": openaiPricing(2.50, 1.25, 10.00),
  "o4-mini": openaiPricing(1.10, 0.275, 4.40),
  o3: openaiPricing(2.00, 0.50, 8.00),
  codex: openaiPricing(1.50, 0.375, 6.00),
  kimi: openaiPricing(0.50, 0.10, 2.00),
  wuu: claudePricing(3.00, 15.00, 0.30, 3.75, 6.00),
  default: claudePricing(5.00, 25.00, 0.50, 6.25, 10.00),
};

export interface UsageRecord {
  ts: string;
  msgId: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  projectPath: string;
}

export interface UsageBucket {
  label: string;
  hourStart: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cost: number;
  calls: number;
}

export interface ProjectUsage {
  path: string;
  name: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cost: number;
  calls: number;
}

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  cost: number;
  calls: number;
}

export interface UsageSummary {
  date: string;
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreate5m: number;
  totalCacheCreate1h: number;
  totalCost: number;
  buckets: UsageBucket[];
  projects: ProjectUsage[];
  models: ModelUsage[];
}

interface CachedUsageSummary {
  summary: UsageSummary;
  cachedAt: number;
}

interface HeatmapDailyTotal {
  tokens: number;
  cost: number;
}

interface HeatmapFileCacheEntry {
  mtimeMs: number;
  size: number;
  days: Record<string, HeatmapDailyTotal>;
}

interface HeatmapDiskCache {
  version: number;
  files: Record<string, HeatmapFileCacheEntry>;
}

const TODAY_USAGE_CACHE_TTL_MS = 30_000;
const HEATMAP_CACHE_TTL_MS = 5 * 60_000;
const HEATMAP_DISK_CACHE_VERSION = 1;
const HEATMAP_DISK_CACHE_FILE = path.join(
  TERMCANVAS_DIR,
  "usage-heatmap-cache.json",
);

const usageSummaryCache = new Map<string, CachedUsageSummary>();
let heatmapCache:
  | { data: Record<string, { tokens: number; cost: number }>; cachedAt: number }
  | null = null;
let heatmapDiskCache: HeatmapDiskCache | null = null;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function perfLog(label: string, details: Record<string, unknown>) {
  if (!process.env.VITE_DEV_SERVER_URL) return;
  console.log(`[Perf] ${label}`, details);
}

function matchPricing(model: string) {
  if (PRICING[model]) return PRICING[model];
  for (const key of Object.keys(PRICING)
    .filter((candidate) => candidate !== "default")
    .sort((a, b) => b.length - a.length)) {
    if (model.startsWith(key)) return PRICING[key];
  }
  return PRICING.default;
}

export function computeCost(model: string, input: number, output: number, cacheRead: number, cacheCreate5m: number, cacheCreate1h: number): number {
  const p = matchPricing(model);
  const totalInputTokens = input + cacheRead + cacheCreate5m + cacheCreate1h;
  const useLongContextRate =
    p.long_context_threshold_tokens !== undefined &&
    totalInputTokens > p.long_context_threshold_tokens;
  const inputMultiplier = useLongContextRate
    ? (p.long_context_input_multiplier ?? 1)
    : 1;
  const outputMultiplier = useLongContextRate
    ? (p.long_context_output_multiplier ?? 1)
    : 1;

  return (input / 1e6) * p.input * inputMultiplier
       + (output / 1e6) * p.output * outputMultiplier
       + (cacheRead / 1e6) * p.cache_read * inputMultiplier
       + (cacheCreate5m / 1e6) * p.cache_create_5m * inputMultiplier
       + (cacheCreate1h / 1e6) * p.cache_create_1h * inputMultiplier;
}

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shouldReuseUsageSummary(
  dateStr: string,
  cachedAt: number,
  nowMs = Date.now(),
): boolean {
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return false;
  const today = toLocalDateString(new Date(nowMs));
  if (dateStr !== today) return true;
  return nowMs - cachedAt < TODAY_USAGE_CACHE_TTL_MS;
}

export function shouldReuseTimedCache(
  cachedAt: number,
  ttlMs: number,
  nowMs = Date.now(),
): boolean {
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return false;
  return nowMs - cachedAt < ttlMs;
}

export function getLocalTzOffsetHours(): number {
  return -(new Date().getTimezoneOffset() / 60);
}

/** Convert a target date (YYYY-MM-DD, local) to UTC start/end strings for filtering.
 *  new Date("YYYY-MM-DDT00:00:00") already parses as local midnight,
 *  so getTime() returns the correct UTC epoch — no manual tz adjustment needed. */
export function dateToUtcRange(dateStr: string): { utcStart: string; utcEnd: string } {
  const startMs = new Date(`${dateStr}T00:00:00`).getTime();
  const endMs = startMs + 86400_000;
  const fmt = (ms: number) => new Date(ms).toISOString().replace("Z", "").split(".")[0];
  return { utcStart: fmt(startMs), utcEnd: fmt(endMs) };
}

function utcToLocalHour(tsClean: string, tzOffsetHours: number): number {
  const utcMs = new Date(tsClean + "Z").getTime();
  const localMs = utcMs + tzOffsetHours * 3600_000;
  return new Date(localMs).getUTCHours();
}

function loadHeatmapDiskCache(): HeatmapDiskCache {
  if (heatmapDiskCache) {
    return heatmapDiskCache;
  }

  try {
    const raw = fs.readFileSync(HEATMAP_DISK_CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as HeatmapDiskCache;
    if (parsed.version === HEATMAP_DISK_CACHE_VERSION && parsed.files) {
      heatmapDiskCache = parsed;
      return parsed;
    }
  } catch {
  }

  heatmapDiskCache = {
    version: HEATMAP_DISK_CACHE_VERSION,
    files: {},
  };
  return heatmapDiskCache;
}

function saveHeatmapDiskCache(cache: HeatmapDiskCache): void {
  const tmp = `${HEATMAP_DISK_CACHE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache), "utf-8");
  fs.renameSync(tmp, HEATMAP_DISK_CACHE_FILE);
}

function bucketHeatmapRecord(
  target: Record<string, HeatmapDailyTotal>,
  record: UsageRecord,
  tzOffsetHours: number,
): void {
  const utcMs = new Date(record.ts + "Z").getTime();
  const localMs = utcMs + tzOffsetHours * 3600_000;
  const localDate = new Date(localMs);
  const dateStr = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, "0")}-${String(localDate.getUTCDate()).padStart(2, "0")}`;

  const tokens =
    record.input +
    record.output +
    record.cacheRead +
    record.cacheCreate5m +
    record.cacheCreate1h;
  const cost = computeCost(
    record.model,
    record.input,
    record.output,
    record.cacheRead,
    record.cacheCreate5m,
    record.cacheCreate1h,
  );

  if (!target[dateStr]) {
    target[dateStr] = { tokens: 0, cost: 0 };
  }
  target[dateStr].tokens += tokens;
  target[dateStr].cost += cost;
}

function mergeHeatmapDays(
  target: Record<string, HeatmapDailyTotal>,
  days: Record<string, HeatmapDailyTotal>,
): void {
  for (const [dateStr, entry] of Object.entries(days)) {
    if (!target[dateStr]) {
      target[dateStr] = { tokens: 0, cost: 0 };
    }
    target[dateStr].tokens += entry.tokens;
    target[dateStr].cost += entry.cost;
  }
}

function buildHeatmapEntry(
  filePath: string,
  parser: (
    filePath: string,
    utcStart: string,
    utcEnd: string,
  ) => { records: UsageRecord[] },
  utcStart: string,
  utcEnd: string,
  tzOffsetHours: number,
  stat: fs.Stats,
): HeatmapFileCacheEntry {
  const days: Record<string, HeatmapDailyTotal> = {};
  const { records } = parser(filePath, utcStart, utcEnd);
  for (const record of records) {
    bucketHeatmapRecord(days, record, tzOffsetHours);
  }
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    days,
  };
}

function collectJsonlRecursive(dir: string, files: string[], depth = 0): void {
  if (depth > 4) return; // guard against deep nesting
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile() && entry.endsWith(".jsonl")) {
          files.push(full);
        } else if (stat.isDirectory()) {
          collectJsonlRecursive(full, files, depth + 1);
        }
      } catch { /* skip inaccessible */ }
    }
  } catch { /* skip */ }
}

export function findClaudeJsonlFiles(): string[] {
  const claudeDir = path.join(os.homedir(), ".claude");
  const projectsDir = path.join(claudeDir, "projects");
  const files: string[] = [];

  if (fs.existsSync(projectsDir)) {
    collectJsonlRecursive(projectsDir, files);
  }

  try {
    const rootJsonls = fs.readdirSync(claudeDir).filter((f) => f.endsWith(".jsonl"));
    for (const f of rootJsonls) files.push(path.join(claudeDir, f));
  } catch { /* skip */ }

  return files;
}

export function findCodexJsonlFiles(): string[] {
  const codexDir = path.join(os.homedir(), ".codex");
  const files: string[] = [];

  // Active sessions: ~/.codex/sessions/YYYY/MM/DD/*.jsonl
  const sessionsDir = path.join(codexDir, "sessions");
  if (fs.existsSync(sessionsDir)) {
    try {
      const years = fs.readdirSync(sessionsDir);
      for (const y of years) {
        const yDir = path.join(sessionsDir, y);
        try {
          const months = fs.readdirSync(yDir);
          for (const m of months) {
            const mDir = path.join(yDir, m);
            try {
              const days = fs.readdirSync(mDir);
              for (const d of days) {
                const dDir = path.join(mDir, d);
                try {
                  const jsonls = fs.readdirSync(dDir).filter((f) => f.endsWith(".jsonl"));
                  for (const f of jsonls) files.push(path.join(dDir, f));
                } catch { /* skip */ }
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // Archived sessions: ~/.codex/archived_sessions/*.jsonl
  const archivedDir = path.join(codexDir, "archived_sessions");
  if (fs.existsSync(archivedDir)) {
    try {
      const jsonls = fs.readdirSync(archivedDir).filter((f) => f.endsWith(".jsonl"));
      for (const f of jsonls) files.push(path.join(archivedDir, f));
    } catch { /* skip */ }
  }

  return files;
}

export function findKimiSessionFiles(): Array<{ sessionId: string; filePath: string }> {
  const home = os.homedir();
  const sessionsRoot = path.join(home, ".kimi", "sessions");
  const results: Array<{ sessionId: string; filePath: string }> = [];
  if (!fs.existsSync(sessionsRoot)) {
    return results;
  }

  try {
    const hashDirs = fs.readdirSync(sessionsRoot);
    for (const hashDir of hashDirs) {
      const fullHashDir = path.join(sessionsRoot, hashDir);
      try {
        const stat = fs.statSync(fullHashDir);
        if (!stat.isDirectory()) continue;
      } catch { continue; }

      let entries: string[];
      try {
        entries = fs.readdirSync(fullHashDir);
      } catch { continue; }

      for (const entry of entries) {
        const sessionDir = path.join(fullHashDir, entry);
        try {
          const s = fs.statSync(sessionDir);
          if (!s.isDirectory()) continue;
        } catch { continue; }
        const contextFile = path.join(sessionDir, "context.jsonl");
        if (fs.existsSync(contextFile)) {
          results.push({ sessionId: entry, filePath: contextFile });
        }
      }
    }
  } catch { /* skip */ }

  return results;
}

export function findKimiWireFiles(): string[] {
  const home = os.homedir();
  const sessionsRoot = path.join(home, ".kimi", "sessions");
  const files: string[] = [];
  if (!fs.existsSync(sessionsRoot)) {
    return files;
  }

  try {
    const hashDirs = fs.readdirSync(sessionsRoot);
    for (const hashDir of hashDirs) {
      const fullHashDir = path.join(sessionsRoot, hashDir);
      try {
        const stat = fs.statSync(fullHashDir);
        if (!stat.isDirectory()) continue;
      } catch { continue; }

      let entries: string[];
      try {
        entries = fs.readdirSync(fullHashDir);
      } catch { continue; }

      for (const entry of entries) {
        const sessionDir = path.join(fullHashDir, entry);
        try {
          const s = fs.statSync(sessionDir);
          if (!s.isDirectory()) continue;
        } catch { continue; }
        const wireFile = path.join(sessionDir, "wire.jsonl");
        if (fs.existsSync(wireFile)) {
          files.push(wireFile);
        }
      }
    }
  } catch { /* skip */ }

  return files;
}

export function parseKimiWireFile(
  filePath: string,
  utcStart: string,
  utcEnd: string,
): { records: UsageRecord[]; projectPath: string } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return { records: [], projectPath: "" };
  }

  const records: UsageRecord[] = [];
  let eventIndex = 0;

  for (const line of content.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch { continue; }

    const message = getObject(obj.message);
    if (!message) continue;
    if (message.type !== "StatusUpdate") continue;

    const payload = getObject(message.payload);
    if (!payload) continue;

    const tokenUsage = getObject(payload.token_usage);
    if (!tokenUsage) continue;

    const ts = obj.timestamp;
    if (typeof ts !== "number") continue;
    const tsClean = new Date(ts * 1000).toISOString().replace("Z", "").split(".")[0];
    if (tsClean < utcStart || tsClean >= utcEnd) continue;

    const inputOther = (tokenUsage.input_other as number) ?? 0;
    const output = (tokenUsage.output as number) ?? 0;
    const cacheRead = (tokenUsage.input_cache_read as number) ?? 0;
    const cacheCreate = (tokenUsage.input_cache_creation as number) ?? 0;

    records.push({
      ts: tsClean,
      msgId: `${path.basename(path.dirname(filePath))}:status:${eventIndex}`,
      model: "kimi",
      input: inputOther,
      output,
      cacheRead,
      cacheCreate5m: cacheCreate,
      cacheCreate1h: 0,
      projectPath: "",
    });
    eventIndex += 1;
  }

  return { records, projectPath: "" };
}

export function findWuuSessionFiles(): string[] {
  const home = os.homedir();
  const sessionsDir = path.join(home, ".wuu", "sessions");
  const files: string[] = [];
  if (!fs.existsSync(sessionsDir)) {
    return files;
  }

  try {
    const entries = fs.readdirSync(sessionsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const filePath = path.join(sessionsDir, entry);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
      } catch { continue; }
      files.push(filePath);
    }
  } catch { /* skip */ }

  return files;
}

export function parseWuuSession(
  filePath: string,
  utcStart: string,
  utcEnd: string,
): { records: UsageRecord[]; projectPath: string } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return { records: [], projectPath: "" };
  }

  const records: UsageRecord[] = [];
  let eventIndex = 0;

  for (const line of content.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch { continue; }

    const role = getString(obj.role);
    const contentType = getString(obj.content);
    if (role !== "meta" || contentType !== "token_usage") continue;

    const at = getString(obj.at);
    if (!at) continue;
    const tsClean = at.replace("Z", "").split(".")[0];
    if (tsClean < utcStart || tsClean >= utcEnd) continue;

    const inputTokens = (obj.input_tokens as number) ?? 0;
    const outputTokens = (obj.output_tokens as number) ?? 0;

    records.push({
      ts: tsClean,
      msgId: `${path.basename(filePath, ".jsonl")}:usage:${eventIndex}`,
      model: "wuu",
      input: inputTokens,
      output: outputTokens,
      cacheRead: 0,
      cacheCreate5m: 0,
      cacheCreate1h: 0,
      projectPath: "",
    });
    eventIndex += 1;
  }

  return { records, projectPath: "" };
}

export function parseClaudeSession(
  filePath: string,
  utcStart: string,
  utcEnd: string,
): { records: UsageRecord[]; projectPath: string } {
  let projectPath = "";

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return { records: [], projectPath };
  }

  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  const rel = path.relative(projectsDir, filePath);
  const topDir = rel.split(path.sep)[0];
  if (topDir && topDir.startsWith("-")) {
    const cleaned = topDir.replace(/(--worktrees-|-.worktrees-).*$/, "");
    projectPath = cleaned.replace(/-/g, "/");
  }

  // Deduplicate by message ID — keep only the last entry per message
  const byMsgId = new Map<string, UsageRecord>();

  for (const line of content.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch { continue; }

    const ts = obj.timestamp;
    if (typeof ts !== "string" || !ts) continue;

    const msg = obj.message;
    if (!msg || typeof msg !== "object") continue;
    const usage = (msg as Record<string, unknown>).usage;
    if (!usage || typeof usage !== "object") continue;

    const tsClean = ts.replace("Z", "").split("+")[0];
    if (tsClean < utcStart || tsClean >= utcEnd) continue;

    const u = usage as Record<string, unknown>;
    const model = ((msg as Record<string, unknown>).model as string) ?? "unknown";
    if (model.startsWith("<") || model === "unknown") continue;
    const msgId = ((msg as Record<string, unknown>).id as string) ?? tsClean;

    const ccTotal = (u.cache_creation_input_tokens as number) ?? 0;
    const cacheDetail = u.cache_creation as Record<string, number> | undefined;
    const cc1h = cacheDetail?.ephemeral_1h_input_tokens ?? 0;
    // Put remainder into 5m if breakdown doesn't sum to total
    const cc5m = cacheDetail?.ephemeral_5m_input_tokens ?? Math.max(0, ccTotal - cc1h);
    const cc5mFinal = (cc5m + cc1h < ccTotal) ? ccTotal - cc1h : cc5m;

    byMsgId.set(msgId, {
      ts: tsClean,
      msgId,
      model,
      input: (u.input_tokens as number) ?? 0,
      output: (u.output_tokens as number) ?? 0,
      cacheRead: (u.cache_read_input_tokens as number) ?? 0,
      cacheCreate5m: cc5mFinal,
      cacheCreate1h: cc1h,
      projectPath,
    });
  }

  return { records: [...byMsgId.values()], projectPath };
}

export function parseCodexSession(
  filePath: string,
  utcStart: string,
  utcEnd: string,
): { records: UsageRecord[]; projectPath: string } {
  let projectPath = "";

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return { records: [], projectPath };
  }

  const records: UsageRecord[] = [];
  let currentModel = "codex";
  let previousTotals:
    | {
        input: number;
        cached: number;
        output: number;
      }
    | null = null;
  let tokenEventIndex = 0;

  for (const line of content.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch { continue; }

    if (obj.type === "session_meta") {
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (payload?.cwd) projectPath = payload.cwd as string;
      continue;
    }

    if (obj.type === "turn_context") {
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (typeof payload?.model === "string" && payload.model) {
        currentModel = payload.model;
      }
      continue;
    }

    if (obj.type !== "event_msg") continue;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (!payload || payload.type !== "token_count") continue;

    const ts = obj.timestamp;
    if (typeof ts !== "string" || !ts) continue;
    const tsClean = ts.replace("Z", "").split("+")[0];
    if (tsClean < utcStart || tsClean >= utcEnd) continue;

    const info = payload.info as Record<string, unknown> | null;
    if (!info) continue;

    const lastUsage = info.last_token_usage as Record<string, number> | undefined;
    const totalUsage = info.total_token_usage as Record<string, number> | undefined;
    if (!lastUsage && !totalUsage) continue;

    let inputTotal = 0;
    let cachedInput = 0;
    let outputTokens = 0;

    if (lastUsage) {
      inputTotal = lastUsage.input_tokens ?? 0;
      cachedInput = lastUsage.cached_input_tokens ?? 0;
      outputTokens = lastUsage.output_tokens ?? 0;
    } else if (totalUsage) {
      const nextTotals = {
        input: totalUsage.input_tokens ?? 0,
        cached: totalUsage.cached_input_tokens ?? 0,
        output: totalUsage.output_tokens ?? 0,
      };
      if (previousTotals) {
        inputTotal = Math.max(0, nextTotals.input - previousTotals.input);
        cachedInput = Math.max(0, nextTotals.cached - previousTotals.cached);
        outputTokens = Math.max(0, nextTotals.output - previousTotals.output);
      } else {
        inputTotal = nextTotals.input;
        cachedInput = nextTotals.cached;
        outputTokens = nextTotals.output;
      }
    }

    if (totalUsage) {
      previousTotals = {
        input: totalUsage.input_tokens ?? 0,
        cached: totalUsage.cached_input_tokens ?? 0,
        output: totalUsage.output_tokens ?? 0,
      };
    }

    if (tsClean < utcStart || tsClean >= utcEnd) continue;

    records.push({
      ts: tsClean,
      msgId: `${path.basename(filePath)}:token:${tokenEventIndex}`,
      model: currentModel,
      input: Math.max(0, inputTotal - cachedInput),
      output: outputTokens,
      cacheRead: cachedInput,
      cacheCreate5m: 0,
      cacheCreate1h: 0,
      projectPath,
    });
    tokenEventIndex += 1;
  }

  return { records, projectPath };
}

/**
 * Collect heatmap data for the last 91 days in a single pass.
 * Scans files once, reads each file once, buckets records by local date.
 * Uses setImmediate chunking to avoid blocking the main thread.
 */
export async function collectHeatmapData(): Promise<Record<string, { tokens: number; cost: number }>> {
  if (
    heatmapCache &&
    shouldReuseTimedCache(heatmapCache.cachedAt, HEATMAP_CACHE_TTL_MS)
  ) {
    return heatmapCache.data;
  }

  const HEATMAP_DAYS = 91;
  const tzOffsetHours = getLocalTzOffsetHours();

  const today = new Date();
  const startLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (HEATMAP_DAYS - 1));
  const endLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1); // tomorrow midnight
  const fmt = (ms: number) => new Date(ms).toISOString().replace("Z", "").split(".")[0];
  const utcStart = fmt(startLocal.getTime());
  const utcEnd = fmt(endLocal.getTime());
  const startDateStr = `${startLocal.getFullYear()}-${String(startLocal.getMonth() + 1).padStart(2, "0")}-${String(startLocal.getDate()).padStart(2, "0")}`;

  const claudeFiles = findClaudeJsonlFiles();
  const codexFiles = findCodexJsonlFiles();
  const kimiWireFiles = findKimiWireFiles();
  const wuuFiles = findWuuSessionFiles();
  const diskCache = loadHeatmapDiskCache();
  let cacheDirty = false;
  const livePaths = new Set<string>();
  let reusedFiles = 0;
  let parsedFiles = 0;

  const result: Record<string, { tokens: number; cost: number }> = {};
  const startedAt = Date.now();

  // Yield between files so large session scans don't monopolize the main
  for (let i = 0; i < claudeFiles.length; i++) {
    if (i > 0) await yieldToEventLoop();
    const f = claudeFiles[i];
    let stat: fs.Stats;
    try {
      stat = fs.statSync(f);
      livePaths.add(f);
      const mtimeLocal = new Date(stat.mtimeMs + tzOffsetHours * 3600_000);
      const mtimeDate = mtimeLocal.toISOString().split("T")[0];
      if (mtimeDate < startDateStr) continue;
    } catch { continue; }

    const cached = diskCache.files[f];
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      mergeHeatmapDays(result, cached.days);
      reusedFiles += 1;
      continue;
    }

    const entry = buildHeatmapEntry(
      f,
      parseClaudeSession,
      utcStart,
      utcEnd,
      tzOffsetHours,
      stat,
    );
    diskCache.files[f] = entry;
    mergeHeatmapDays(result, entry.days);
    parsedFiles += 1;
    cacheDirty = true;
  }

  for (let i = 0; i < codexFiles.length; i++) {
    if (i > 0) await yieldToEventLoop();
    const f = codexFiles[i];
    let stat: fs.Stats;
    try {
      stat = fs.statSync(f);
      livePaths.add(f);
      const mtimeLocal = new Date(stat.mtimeMs + tzOffsetHours * 3600_000);
      const mtimeDate = mtimeLocal.toISOString().split("T")[0];
      if (mtimeDate < startDateStr) continue;
    } catch { continue; }

    const cached = diskCache.files[f];
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      mergeHeatmapDays(result, cached.days);
      reusedFiles += 1;
      continue;
    }

    const entry = buildHeatmapEntry(
      f,
      parseCodexSession,
      utcStart,
      utcEnd,
      tzOffsetHours,
      stat,
    );
    diskCache.files[f] = entry;
    mergeHeatmapDays(result, entry.days);
    parsedFiles += 1;
    cacheDirty = true;
  }

  for (let i = 0; i < kimiWireFiles.length; i++) {
    if (i > 0) await yieldToEventLoop();
    const f = kimiWireFiles[i];
    let stat: fs.Stats;
    try {
      stat = fs.statSync(f);
      livePaths.add(f);
      const mtimeLocal = new Date(stat.mtimeMs + tzOffsetHours * 3600_000);
      const mtimeDate = mtimeLocal.toISOString().split("T")[0];
      if (mtimeDate < startDateStr) continue;
    } catch { continue; }

    const cached = diskCache.files[f];
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      mergeHeatmapDays(result, cached.days);
      reusedFiles += 1;
      continue;
    }

    const entry = buildHeatmapEntry(
      f,
      (fp, us, ue) => parseKimiWireFile(fp, us, ue).records,
      utcStart,
      utcEnd,
      tzOffsetHours,
      stat,
    );
    diskCache.files[f] = entry;
    mergeHeatmapDays(result, entry.days);
    parsedFiles += 1;
    cacheDirty = true;
  }

  for (let i = 0; i < wuuFiles.length; i++) {
    if (i > 0) await yieldToEventLoop();
    const f = wuuFiles[i];
    let stat: fs.Stats;
    try {
      stat = fs.statSync(f);
      livePaths.add(f);
      const mtimeLocal = new Date(stat.mtimeMs + tzOffsetHours * 3600_000);
      const mtimeDate = mtimeLocal.toISOString().split("T")[0];
      if (mtimeDate < startDateStr) continue;
    } catch { continue; }

    const cached = diskCache.files[f];
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      mergeHeatmapDays(result, cached.days);
      reusedFiles += 1;
      continue;
    }

    const entry = buildHeatmapEntry(
      f,
      (fp, us, ue) => parseWuuSession(fp, us, ue).records,
      utcStart,
      utcEnd,
      tzOffsetHours,
      stat,
    );
    diskCache.files[f] = entry;
    mergeHeatmapDays(result, entry.days);
    parsedFiles += 1;
    cacheDirty = true;
  }

  for (const filePath of Object.keys(diskCache.files)) {
    if (!livePaths.has(filePath)) {
      delete diskCache.files[filePath];
      cacheDirty = true;
    }
  }

  if (cacheDirty) {
    saveHeatmapDiskCache(diskCache);
  }

  heatmapCache = { data: result, cachedAt: Date.now() };
  perfLog("usage:heatmap:file-cache", {
    ms: Date.now() - startedAt,
    claudeFiles: claudeFiles.length,
    codexFiles: codexFiles.length,
    kimiFiles: kimiWireFiles.length,
    wuuFiles: wuuFiles.length,
    reusedFiles,
    parsedFiles,
  });
  return result;
}

/**
 * Collect usage data for a given date (local timezone).
 * Uses the machine's local timezone by default.
 * Uses setImmediate chunking to avoid blocking the main thread.
 * @param dateStr YYYY-MM-DD in local timezone
 * @param intervalHours Bucket interval in hours (default 2)
 */
export async function collectUsage(
  dateStr: string,
  intervalHours = 2,
): Promise<UsageSummary> {
  const cached = usageSummaryCache.get(dateStr);
  if (cached && shouldReuseUsageSummary(dateStr, cached.cachedAt)) {
    return cached.summary;
  }

  const tzOffsetHours = getLocalTzOffsetHours();
  const { utcStart, utcEnd } = dateToUtcRange(dateStr);

  const allRecords: UsageRecord[] = [];
  const sessionPaths = new Set<string>();

  const claudeFiles = findClaudeJsonlFiles();
  for (let i = 0; i < claudeFiles.length; i++) {
    if (i > 0) await yieldToEventLoop();
    const f = claudeFiles[i];
    try {
      const mtime = fs.statSync(f).mtimeMs;
      const mtimeLocal = new Date(mtime + tzOffsetHours * 3600_000);
      const mtimeDate = mtimeLocal.toISOString().split("T")[0];
      if (mtimeDate < dateStr) continue;
    } catch { continue; }

    const { records } = parseClaudeSession(f, utcStart, utcEnd);
    if (records.length > 0) {
      allRecords.push(...records);
      sessionPaths.add(f);
    }
  }

  const codexFiles = findCodexJsonlFiles();
  for (let i = 0; i < codexFiles.length; i++) {
    if (i > 0) await yieldToEventLoop();
    const f = codexFiles[i];
    try {
      const mtime = fs.statSync(f).mtimeMs;
      const mtimeLocal = new Date(mtime + tzOffsetHours * 3600_000);
      const mtimeDate = mtimeLocal.toISOString().split("T")[0];
      if (mtimeDate < dateStr) continue;
    } catch { continue; }

    const { records } = parseCodexSession(f, utcStart, utcEnd);
    if (records.length > 0) {
      allRecords.push(...records);
      sessionPaths.add(f);
    }
  }

  const kimiWireFiles = findKimiWireFiles();
  for (let i = 0; i < kimiWireFiles.length; i++) {
    if (i > 0) await yieldToEventLoop();
    const f = kimiWireFiles[i];
    try {
      const mtime = fs.statSync(f).mtimeMs;
      const mtimeLocal = new Date(mtime + tzOffsetHours * 3600_000);
      const mtimeDate = mtimeLocal.toISOString().split("T")[0];
      if (mtimeDate < dateStr) continue;
    } catch { continue; }

    const { records } = parseKimiWireFile(f, utcStart, utcEnd);
    if (records.length > 0) {
      allRecords.push(...records);
      sessionPaths.add(f);
    }
  }

  const wuuFiles = findWuuSessionFiles();
  for (let i = 0; i < wuuFiles.length; i++) {
    if (i > 0) await yieldToEventLoop();
    const f = wuuFiles[i];
    try {
      const mtime = fs.statSync(f).mtimeMs;
      const mtimeLocal = new Date(mtime + tzOffsetHours * 3600_000);
      const mtimeDate = mtimeLocal.toISOString().split("T")[0];
      if (mtimeDate < dateStr) continue;
    } catch { continue; }

    const { records } = parseWuuSession(f, utcStart, utcEnd);
    if (records.length > 0) {
      allRecords.push(...records);
      sessionPaths.add(f);
    }
  }

  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreate5m = 0, totalCacheCreate1h = 0, totalCost = 0;

  const bucketCount = 24 / intervalHours;
  const buckets: UsageBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const h = i * intervalHours;
    return {
      label: `${String(h).padStart(2, "0")}:00-${String(h + intervalHours).padStart(2, "0")}:00`,
      hourStart: h,
      input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0, cost: 0, calls: 0,
    };
  });

  const projectMap = new Map<string, ProjectUsage>();
  const modelMap = new Map<string, ModelUsage>();

  for (const r of allRecords) {
    const cost = computeCost(r.model, r.input, r.output, r.cacheRead, r.cacheCreate5m, r.cacheCreate1h);

    totalInput += r.input;
    totalOutput += r.output;
    totalCacheRead += r.cacheRead;
    totalCacheCreate5m += r.cacheCreate5m;
    totalCacheCreate1h += r.cacheCreate1h;
    totalCost += cost;

    const localHour = utcToLocalHour(r.ts, tzOffsetHours);
    const bucketIdx = Math.floor(localHour / intervalHours);
    if (bucketIdx >= 0 && bucketIdx < bucketCount) {
      const b = buckets[bucketIdx];
      b.input += r.input;
      b.output += r.output;
      b.cacheRead += r.cacheRead;
      b.cacheCreate5m += r.cacheCreate5m;
      b.cacheCreate1h += r.cacheCreate1h;
      b.cost += cost;
      b.calls++;
    }

    const pKey = r.projectPath || "unknown";
    if (!projectMap.has(pKey)) {
      const name = pKey === "unknown" ? "Other" : path.basename(pKey);
      projectMap.set(pKey, { path: pKey, name, input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0, cost: 0, calls: 0 });
    }
    const proj = projectMap.get(pKey)!;
    proj.input += r.input;
    proj.output += r.output;
    proj.cacheRead += r.cacheRead;
    proj.cacheCreate5m += r.cacheCreate5m;
    proj.cacheCreate1h += r.cacheCreate1h;
    proj.cost += cost;
    proj.calls++;

    if (!modelMap.has(r.model)) {
      modelMap.set(r.model, { model: r.model, input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0, cost: 0, calls: 0 });
    }
    const mod = modelMap.get(r.model)!;
    mod.input += r.input;
    mod.output += r.output;
    mod.cacheRead += r.cacheRead;
    mod.cacheCreate5m += r.cacheCreate5m;
    mod.cacheCreate1h += r.cacheCreate1h;
    mod.cost += cost;
    mod.calls++;
  }

  const projects = [...projectMap.values()].sort((a, b) => b.cost - a.cost);
  const models = [...modelMap.values()].sort((a, b) => b.cost - a.cost);

  const summary = {
    date: dateStr,
    sessions: sessionPaths.size,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheCreate5m,
    totalCacheCreate1h,
    totalCost,
    buckets,
    projects,
    models,
  };
  usageSummaryCache.set(dateStr, { summary, cachedAt: Date.now() });
  return summary;
}
