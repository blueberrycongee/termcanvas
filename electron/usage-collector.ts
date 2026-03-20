import fs from "fs";
import path from "path";
import os from "os";

// ── Pricing (per million tokens) ───────────────────────────────────────

const PRICING: Record<string, { input: number; output: number; cache_read: number; cache_create_5m: number; cache_create_1h: number }> = {
  "claude-opus-4-6":   { input: 5.00, output: 25.00, cache_read: 0.50, cache_create_5m: 6.25,  cache_create_1h: 10.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00, cache_read: 0.30, cache_create_5m: 3.75,  cache_create_1h: 6.00 },
  "claude-haiku-4-5":  { input: 1.00, output:  5.00, cache_read: 0.10, cache_create_5m: 1.25,  cache_create_1h: 2.00 },
  codex:               { input: 1.50, output:  6.00, cache_read: 0.375, cache_create_5m: 1.50,  cache_create_1h: 1.50 },
  default:             { input: 5.00, output: 25.00, cache_read: 0.50, cache_create_5m: 6.25,  cache_create_1h: 10.00 },
};

// ── Types ──────────────────────────────────────────────────────────────

export interface UsageRecord {
  ts: string;         // UTC ISO string (no Z)
  msgId: string;      // unique key for deduplication
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
  projectPath: string; // cwd of the session, for project matching
}

export interface UsageBucket {
  label: string;      // e.g. "10:00-12:00"
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
  date: string;               // YYYY-MM-DD
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreate5m: number;
  totalCacheCreate1h: number;
  totalCost: number;
  buckets: UsageBucket[];     // 2-hour buckets
  projects: ProjectUsage[];
  models: ModelUsage[];
}

// ── Helpers ────────────────────────────────────────────────────────────

function matchPricing(model: string) {
  if (PRICING[model]) return PRICING[model];
  // Match versioned model IDs like "claude-opus-4-6-20251001" → "claude-opus-4-6"
  for (const key of Object.keys(PRICING)) {
    if (key !== "default" && model.startsWith(key)) return PRICING[key];
  }
  return PRICING.default;
}

export function computeCost(model: string, input: number, output: number, cacheRead: number, cacheCreate5m: number, cacheCreate1h: number): number {
  const p = matchPricing(model);
  return (input / 1e6) * p.input
       + (output / 1e6) * p.output
       + (cacheRead / 1e6) * p.cache_read
       + (cacheCreate5m / 1e6) * p.cache_create_5m
       + (cacheCreate1h / 1e6) * p.cache_create_1h;
}

/** Get the local timezone offset in hours from UTC. */
export function getLocalTzOffsetHours(): number {
  // getTimezoneOffset returns minutes, negative for east of UTC
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

/** Convert UTC timestamp string to local hour given timezone offset. */
function utcToLocalHour(tsClean: string, tzOffsetHours: number): number {
  const utcMs = new Date(tsClean + "Z").getTime();
  const localMs = utcMs + tzOffsetHours * 3600_000;
  return new Date(localMs).getUTCHours();
}

// ── JSONL file discovery ───────────────────────────────────────────────

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

  // Also check ~/.claude root
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

// ── Claude JSONL parsing ───────────────────────────────────────────────

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

  // Extract project path by finding the "-" prefixed directory under projects/
  // e.g. ~/.claude/projects/-Users-zzzz-termcanvas/session/subagents/xxx.jsonl
  //       → projectPath = "/Users/zzzz/termcanvas"
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  const rel = path.relative(projectsDir, filePath);
  const topDir = rel.split(path.sep)[0];
  if (topDir && topDir.startsWith("-")) {
    // Strip worktree suffix: -Users-zzzz-foo--worktrees-hydra-abc → -Users-zzzz-foo
    const cleaned = topDir.replace(/--worktrees-.*$/, "");
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

    // Overwrite: later entries for same message ID have final usage
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

// ── Codex JSONL parsing ────────────────────────────────────────────────

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

  // For Codex, use total_token_usage from the LAST token_count entry per session.
  // This avoids double-counting incremental entries.
  let lastRecord: UsageRecord | null = null;

  for (const line of content.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch { continue; }

    // Extract cwd from session_meta
    if (obj.type === "session_meta") {
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (payload?.cwd) projectPath = payload.cwd as string;
      continue;
    }

    // Look for token_count events
    if (obj.type !== "event_msg") continue;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (!payload || payload.type !== "token_count") continue;

    const ts = obj.timestamp;
    if (typeof ts !== "string" || !ts) continue;
    const tsClean = ts.replace("Z", "").split("+")[0];
    if (tsClean < utcStart || tsClean >= utcEnd) continue;

    const info = payload.info as Record<string, unknown> | null;
    if (!info) continue;

    const totalUsage = info.total_token_usage as Record<string, number> | undefined;
    if (!totalUsage) continue;

    // Keep overwriting — the last one in the file is the final cumulative total
    lastRecord = {
      ts: tsClean,
      msgId: path.basename(filePath) + ":total",
      model: "codex",
      input: totalUsage.input_tokens ?? 0,
      output: totalUsage.output_tokens ?? 0,
      cacheRead: totalUsage.cached_input_tokens ?? 0,
      cacheCreate5m: 0,
      cacheCreate1h: 0,
      projectPath,
    };
  }

  return { records: lastRecord ? [lastRecord] : [], projectPath };
}

// ── Heatmap API ─────────────────────────────────────────────────────────

/**
 * Collect heatmap data for the last 91 days in a single pass.
 * Scans files once, reads each file once, buckets records by local date.
 * Uses setImmediate chunking to avoid blocking the main thread.
 */
export async function collectHeatmapData(): Promise<Record<string, { tokens: number; cost: number }>> {
  const HEATMAP_DAYS = 91;
  const BATCH_SIZE = 20;
  const tzOffsetHours = getLocalTzOffsetHours();

  // Compute UTC range covering the full 91-day window in local time
  const today = new Date();
  const startLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (HEATMAP_DAYS - 1));
  const endLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1); // tomorrow midnight
  const fmt = (ms: number) => new Date(ms).toISOString().replace("Z", "").split(".")[0];
  const utcStart = fmt(startLocal.getTime());
  const utcEnd = fmt(endLocal.getTime());
  const startDateStr = `${startLocal.getFullYear()}-${String(startLocal.getMonth() + 1).padStart(2, "0")}-${String(startLocal.getDate()).padStart(2, "0")}`;

  // Discover all files once
  const claudeFiles = findClaudeJsonlFiles();
  const codexFiles = findCodexJsonlFiles();

  const result: Record<string, { tokens: number; cost: number }> = {};

  const bucketRecord = (r: UsageRecord) => {
    // Convert UTC timestamp to local date string
    const utcMs = new Date(r.ts + "Z").getTime();
    const localMs = utcMs + tzOffsetHours * 3600_000;
    const localDate = new Date(localMs);
    const dateStr = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, "0")}-${String(localDate.getUTCDate()).padStart(2, "0")}`;

    const tokens = r.input + r.output + r.cacheRead + r.cacheCreate5m + r.cacheCreate1h;
    const cost = computeCost(r.model, r.input, r.output, r.cacheRead, r.cacheCreate5m, r.cacheCreate1h);

    if (!result[dateStr]) {
      result[dateStr] = { tokens: 0, cost: 0 };
    }
    result[dateStr].tokens += tokens;
    result[dateStr].cost += cost;
  };

  // Process Claude files in batches, yielding between batches
  for (let i = 0; i < claudeFiles.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise<void>((r) => setImmediate(r));
    const batch = claudeFiles.slice(i, i + BATCH_SIZE);
    for (const f of batch) {
      try {
        const mtime = fs.statSync(f).mtimeMs;
        const mtimeLocal = new Date(mtime + tzOffsetHours * 3600_000);
        const mtimeDate = mtimeLocal.toISOString().split("T")[0];
        if (mtimeDate < startDateStr) continue;
      } catch { continue; }

      const { records } = parseClaudeSession(f, utcStart, utcEnd);
      for (const r of records) bucketRecord(r);
    }
  }

  // Process Codex files in batches
  for (let i = 0; i < codexFiles.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise<void>((r) => setImmediate(r));
    const batch = codexFiles.slice(i, i + BATCH_SIZE);
    for (const f of batch) {
      try {
        const mtime = fs.statSync(f).mtimeMs;
        const mtimeLocal = new Date(mtime + tzOffsetHours * 3600_000);
        const mtimeDate = mtimeLocal.toISOString().split("T")[0];
        if (mtimeDate < startDateStr) continue;
      } catch { continue; }

      const { records } = parseCodexSession(f, utcStart, utcEnd);
      for (const r of records) bucketRecord(r);
    }
  }

  return result;
}

// ── Main API ───────────────────────────────────────────────────────────

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
  const BATCH_SIZE = 20;
  const tzOffsetHours = getLocalTzOffsetHours();
  const { utcStart, utcEnd } = dateToUtcRange(dateStr);

  const allRecords: UsageRecord[] = [];
  const sessionPaths = new Set<string>();

  // Claude sessions — batched to yield between batches
  const claudeFiles = findClaudeJsonlFiles();
  for (let i = 0; i < claudeFiles.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise<void>((r) => setImmediate(r));
    const batch = claudeFiles.slice(i, i + BATCH_SIZE);
    for (const f of batch) {
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
  }

  // Codex sessions — batched
  const codexFiles = findCodexJsonlFiles();
  for (let i = 0; i < codexFiles.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise<void>((r) => setImmediate(r));
    const batch = codexFiles.slice(i, i + BATCH_SIZE);
    for (const f of batch) {
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
  }

  // ── Aggregate ──

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

    // Bucket
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

    // Project
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

    // Model
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

  return {
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
}
