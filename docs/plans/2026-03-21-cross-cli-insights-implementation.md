# Cross-CLI Insights Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a multi-stage AI-powered insights pipeline that scans Claude & Codex session logs, extracts per-session facets via CLI invocation, aggregates statistics, and generates an HTML report.

**Architecture:** Reuse existing session file discovery from `electron/usage-collector.ts`. New `electron/insights-engine.ts` orchestrates: session scanning → content extraction → batched CLI calls for facet extraction (cached) → aggregation → 5 AI insight rounds → HTML report generation. Frontend adds an "Insights" button to `UsagePanel.tsx` with CLI selector, progress display, and error reporting.

**Tech Stack:** TypeScript, Electron IPC, `child_process.execFile`, xterm session JSONL parsing, HTML template generation.

---

### Task 1: Session Content Extractor

Extract human-readable conversation text from Claude and Codex JSONL session files so the AI can analyze them.

**Files:**
- Create: `electron/insights-engine.ts`

**Step 1: Write the session content extraction functions**

```typescript
// electron/insights-engine.ts
import fs from "fs";
import path from "path";
import os from "os";
import { TERMCANVAS_DIR } from "./state-persistence";

// Re-export session file finders from usage-collector
// We import these internally; they're not exported, so we duplicate the discovery logic
// or refactor usage-collector to export them. For now, duplicate is simpler.

export interface SessionInfo {
  id: string;
  filePath: string;
  cliTool: "claude" | "codex";
  projectPath: string;
  messageCount: number;
  durationMinutes: number;
  contentSummary: string; // truncated conversation text for AI analysis
}

const MAX_SUMMARY_CHARS = 4000;

// ── Claude session content extraction ─────────────────────────────────

export function extractClaudeSessionContent(filePath: string): SessionInfo | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  // Extract project path from file path
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  const rel = path.relative(projectsDir, filePath);
  const topDir = rel.split(path.sep)[0];
  let projectPath = "";
  if (topDir && topDir.startsWith("-")) {
    const cleaned = topDir.replace(/--worktrees-.*$/, "");
    projectPath = cleaned.replace(/-/g, "/");
  }

  // Extract session ID from filename
  const id = path.basename(filePath, ".jsonl");

  // Parse messages and build conversation summary
  const turns: string[] = [];
  let firstTs = "";
  let lastTs = "";
  let userMsgCount = 0;

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = obj.timestamp as string | undefined;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    const role = msg.role as string | undefined;
    if (!role) continue;

    if (role === "user") {
      userMsgCount++;
      const msgContent = msg.content;
      if (typeof msgContent === "string") {
        turns.push(`[User]: ${msgContent}`);
      } else if (Array.isArray(msgContent)) {
        const textParts = (msgContent as Array<Record<string, unknown>>)
          .filter((b) => b.type === "text")
          .map((b) => b.text as string);
        if (textParts.length > 0) {
          turns.push(`[User]: ${textParts.join("\n")}`);
        }
      }
    } else if (role === "assistant") {
      const msgContent = msg.content;
      if (typeof msgContent === "string") {
        turns.push(`[Assistant]: ${msgContent}`);
      } else if (Array.isArray(msgContent)) {
        const textParts = (msgContent as Array<Record<string, unknown>>)
          .filter((b) => b.type === "text")
          .map((b) => b.text as string);
        if (textParts.length > 0) {
          turns.push(`[Assistant]: ${textParts.join("\n")}`);
        }
      }
    }
  }

  // Calculate duration
  let durationMinutes = 0;
  if (firstTs && lastTs) {
    const start = new Date(firstTs).getTime();
    const end = new Date(lastTs).getTime();
    durationMinutes = Math.round((end - start) / 60_000);
  }

  // Filter: skip trivial sessions
  if (userMsgCount < 2 || durationMinutes < 1) return null;

  // Build truncated summary
  let summary = turns.join("\n\n");
  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = summary.slice(0, MAX_SUMMARY_CHARS) + "\n\n[...truncated]";
  }

  return {
    id,
    filePath,
    cliTool: "claude",
    projectPath,
    messageCount: userMsgCount,
    durationMinutes,
    contentSummary: summary,
  };
}

// ── Codex session content extraction ──────────────────────────────────

export function extractCodexSessionContent(filePath: string): SessionInfo | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n").filter(Boolean);
  if (lines.length === 0) return null;

  const id = path.basename(filePath, ".jsonl");
  let projectPath = "";
  const turns: string[] = [];
  let firstTs = "";
  let lastTs = "";
  let userMsgCount = 0;

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = obj.timestamp as string | undefined;
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    if (obj.type === "session_meta") {
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (payload?.cwd) projectPath = payload.cwd as string;
      continue;
    }

    if (obj.type !== "event_msg") continue;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    // User messages
    if (payload.type === "user_message" || payload.type === "input_text") {
      userMsgCount++;
      const text = (payload.text as string) ?? (payload.content as string) ?? "";
      if (text) turns.push(`[User]: ${text}`);
    }

    // Assistant messages
    if (payload.type === "assistant_message" || payload.type === "message") {
      const text = (payload.text as string) ?? (payload.content as string) ?? "";
      if (text) turns.push(`[Assistant]: ${text}`);
    }
  }

  let durationMinutes = 0;
  if (firstTs && lastTs) {
    const start = new Date(firstTs).getTime();
    const end = new Date(lastTs).getTime();
    durationMinutes = Math.round((end - start) / 60_000);
  }

  if (userMsgCount < 2 || durationMinutes < 1) return null;

  let summary = turns.join("\n\n");
  if (summary.length > MAX_SUMMARY_CHARS) {
    summary = summary.slice(0, MAX_SUMMARY_CHARS) + "\n\n[...truncated]";
  }

  return {
    id,
    filePath,
    cliTool: "codex",
    projectPath,
    messageCount: userMsgCount,
    durationMinutes,
    contentSummary: summary,
  };
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep insights`
Expected: no errors related to insights-engine.ts

**Step 3: Commit**

```bash
git add electron/insights-engine.ts
git commit -m "feat(insights): add session content extraction for Claude and Codex"
```

---

### Task 2: Facet Extraction via CLI Process

Add the CLI invocation layer that sends a session summary to `claude --print` or `codex exec` and receives a structured JSON facet back. Includes pre-flight validation and error transparency.

**Files:**
- Modify: `electron/insights-engine.ts`

**Step 1: Add facet types and CLI invocation**

Append to `electron/insights-engine.ts`:

```typescript
import { execFile } from "child_process";
import { buildLaunchSpec } from "./pty-launch.js";

// ── Facet types ───────────────────────────────────────────────────────

export interface SessionFacet {
  session_id: string;
  cli_tool: "claude" | "codex";
  underlying_goal: string;
  brief_summary: string;
  goal_categories: Record<string, number>;
  outcome: "fully_achieved" | "mostly_achieved" | "partially_achieved" | "not_achieved" | "unclear";
  session_type: "single_task" | "multi_task" | "iterative" | "exploratory" | "quick_question";
  friction_counts: Record<string, number>;
  user_satisfaction: "high" | "medium" | "low" | "unclear";
  project_path: string;
}

export interface InsightsProgress {
  stage: "validating" | "scanning" | "extracting_facets" | "aggregating" | "analyzing" | "generating_report";
  current: number;
  total: number;
  message: string;
}

export interface InsightsError {
  code: "cli_not_found" | "auth_failed" | "cli_error" | "parse_error" | "unknown";
  message: string;
  detail?: string;
}

// ── Cache ─────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(TERMCANVAS_DIR, "insights-cache", "facets");

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCachedFacet(sessionId: string): SessionFacet | null {
  const file = path.join(CACHE_DIR, `${sessionId}.json`);
  try {
    const data = fs.readFileSync(file, "utf-8");
    return JSON.parse(data) as SessionFacet;
  } catch {
    return null;
  }
}

function cacheFacet(facet: SessionFacet): void {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `${facet.session_id}.json`);
  fs.writeFileSync(file, JSON.stringify(facet, null, 2));
}

// ── CLI invocation ────────────────────────────────────────────────────

async function resolveCliSpec(cliTool: "claude" | "codex"): Promise<{ file: string; env: Record<string, string> }> {
  const spec = await buildLaunchSpec({
    cwd: process.cwd(),
    shell: cliTool,
  });
  return { file: spec.file, env: spec.env };
}

export async function validateCli(cliTool: "claude" | "codex"): Promise<{ ok: true } | { ok: false; error: InsightsError }> {
  let spec: { file: string; env: Record<string, string> };
  try {
    spec = await resolveCliSpec(cliTool);
  } catch {
    return {
      ok: false,
      error: { code: "cli_not_found", message: `${cliTool} CLI not found. Please install it first.` },
    };
  }

  // Test with a trivial prompt to verify auth
  const testPrompt = "Reply with exactly: OK";
  try {
    const result = await invokeCli(spec, cliTool, testPrompt, 15_000);
    if (!result.includes("OK")) {
      return {
        ok: false,
        error: {
          code: "auth_failed",
          message: `${cliTool} CLI responded but may not be authenticated.`,
          detail: result.slice(0, 500),
        },
      };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: {
        code: "auth_failed",
        message: `${cliTool} CLI auth check failed: ${msg}`,
        detail: msg,
      },
    };
  }
}

function invokeCli(
  spec: { file: string; env: Record<string, string> },
  cliTool: "claude" | "codex",
  prompt: string,
  timeoutMs = 60_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = cliTool === "claude"
      ? ["--print", "-p", prompt]
      : ["exec", prompt];

    const child = execFile(spec.file, args, {
      timeout: timeoutMs,
      env: spec.env,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

// ── Facet extraction prompt ───────────────────────────────────────────

const FACET_PROMPT_PREFIX = `You are analyzing a conversation transcript between a user and an AI coding assistant. Extract structured metadata about this session.

RESPOND WITH ONLY A VALID JSON OBJECT matching this exact schema (no markdown, no explanation):

{
  "underlying_goal": "string - the user's root goal in 1-2 sentences",
  "brief_summary": "string - what happened in 2-3 sentences",
  "goal_categories": {"category_name": count} - e.g. {"bug_fix": 1, "new_feature": 1},
  "outcome": "fully_achieved|mostly_achieved|partially_achieved|not_achieved|unclear",
  "session_type": "single_task|multi_task|iterative|exploratory|quick_question",
  "friction_counts": {"type": count} - types: misunderstanding, wrong_approach, incorrect_code, tool_failure, scope_creep. Use 0 for none,
  "user_satisfaction": "high|medium|low|unclear"
}

Here is the session transcript:

`;

export async function extractFacet(
  session: SessionInfo,
  cliSpec: { file: string; env: Record<string, string> },
  cliTool: "claude" | "codex",
): Promise<SessionFacet | InsightsError> {
  // Check cache first
  const cached = getCachedFacet(session.id);
  if (cached) return cached;

  const prompt = FACET_PROMPT_PREFIX + session.contentSummary + "\n\nRESPOND WITH ONLY A VALID JSON OBJECT.";

  let raw: string;
  try {
    raw = await invokeCli(cliSpec, cliTool, prompt, 120_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { code: "cli_error", message: `Failed to analyze session ${session.id}`, detail: msg };
  }

  // Parse JSON from response (may contain markdown fences)
  let json: string = raw;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) json = fenceMatch[1];

  // Try to find JSON object in response
  const objectMatch = json.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    return { code: "parse_error", message: `Could not parse JSON from CLI response for session ${session.id}`, detail: raw.slice(0, 500) };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(objectMatch[0]);
  } catch {
    return { code: "parse_error", message: `Invalid JSON from CLI for session ${session.id}`, detail: objectMatch[0].slice(0, 500) };
  }

  // Validate required fields
  if (typeof parsed.underlying_goal !== "string" || typeof parsed.outcome !== "string") {
    return { code: "parse_error", message: `Missing required fields in facet for session ${session.id}`, detail: JSON.stringify(parsed).slice(0, 500) };
  }

  const facet: SessionFacet = {
    session_id: session.id,
    cli_tool: session.cliTool,
    underlying_goal: parsed.underlying_goal as string,
    brief_summary: (parsed.brief_summary as string) ?? "",
    goal_categories: (parsed.goal_categories as Record<string, number>) ?? {},
    outcome: parsed.outcome as SessionFacet["outcome"],
    session_type: (parsed.session_type as SessionFacet["session_type"]) ?? "single_task",
    friction_counts: (parsed.friction_counts as Record<string, number>) ?? {},
    user_satisfaction: (parsed.user_satisfaction as SessionFacet["user_satisfaction"]) ?? "unclear",
    project_path: session.projectPath,
  };

  // Cache it
  cacheFacet(facet);
  return facet;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep insights`
Expected: no errors

**Step 3: Commit**

```bash
git add electron/insights-engine.ts
git commit -m "feat(insights): add facet extraction via CLI process with caching and validation"
```

---

### Task 3: Session Scanning & File Discovery

Export the session file discovery functions from `usage-collector.ts` so `insights-engine.ts` can reuse them, and add the `scanAllSessions` function.

**Files:**
- Modify: `electron/usage-collector.ts` — export `findClaudeJsonlFiles` and `findCodexJsonlFiles`
- Modify: `electron/insights-engine.ts` — add `scanAllSessions`

**Step 1: Export file discovery functions**

In `electron/usage-collector.ts`, change:

```typescript
function findClaudeJsonlFiles(): string[] {
```
to:
```typescript
export function findClaudeJsonlFiles(): string[] {
```

And:
```typescript
function findCodexJsonlFiles(): string[] {
```
to:
```typescript
export function findCodexJsonlFiles(): string[] {
```

**Step 2: Add scanAllSessions to insights-engine.ts**

Replace the duplicate discovery logic with imports, and add scanning function:

```typescript
import { findClaudeJsonlFiles, findCodexJsonlFiles } from "./usage-collector";

export function scanAllSessions(): SessionInfo[] {
  const sessions: SessionInfo[] = [];

  const claudeFiles = findClaudeJsonlFiles();
  for (const f of claudeFiles) {
    const info = extractClaudeSessionContent(f);
    if (info) sessions.push(info);
  }

  const codexFiles = findCodexJsonlFiles();
  for (const f of codexFiles) {
    const info = extractCodexSessionContent(f);
    if (info) sessions.push(info);
  }

  return sessions;
}
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "insights|usage-collector"`
Expected: no errors

**Step 4: Commit**

```bash
git add electron/usage-collector.ts electron/insights-engine.ts
git commit -m "feat(insights): export file discovery, add scanAllSessions"
```

---

### Task 4: Aggregation & AI Insight Rounds

Add the aggregation logic that processes all facets into stats, and the 5 AI insight rounds + "At a Glance" summary.

**Files:**
- Modify: `electron/insights-engine.ts`

**Step 1: Add aggregation types and functions**

Append to `electron/insights-engine.ts`:

```typescript
// ── Aggregated stats ──────────────────────────────────────────────────

export interface AggregatedStats {
  totalSessions: number;
  totalMessages: number;
  totalDurationMinutes: number;
  cliBreakdown: Record<string, number>; // cli_tool → session count
  outcomeBreakdown: Record<string, number>;
  sessionTypeBreakdown: Record<string, number>;
  goalCategories: Record<string, number>;
  frictionCounts: Record<string, number>;
  satisfactionBreakdown: Record<string, number>;
  projectBreakdown: Record<string, number>; // project name → session count
}

export function aggregateFacets(facets: SessionFacet[], sessions: SessionInfo[]): AggregatedStats {
  const stats: AggregatedStats = {
    totalSessions: facets.length,
    totalMessages: 0,
    totalDurationMinutes: 0,
    cliBreakdown: {},
    outcomeBreakdown: {},
    sessionTypeBreakdown: {},
    goalCategories: {},
    frictionCounts: {},
    satisfactionBreakdown: {},
    projectBreakdown: {},
  };

  // Build session lookup for message count and duration
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));

  for (const f of facets) {
    const session = sessionMap.get(f.session_id);
    if (session) {
      stats.totalMessages += session.messageCount;
      stats.totalDurationMinutes += session.durationMinutes;
    }

    // CLI breakdown
    stats.cliBreakdown[f.cli_tool] = (stats.cliBreakdown[f.cli_tool] ?? 0) + 1;

    // Outcome
    stats.outcomeBreakdown[f.outcome] = (stats.outcomeBreakdown[f.outcome] ?? 0) + 1;

    // Session type
    stats.sessionTypeBreakdown[f.session_type] = (stats.sessionTypeBreakdown[f.session_type] ?? 0) + 1;

    // Goal categories
    for (const [cat, count] of Object.entries(f.goal_categories)) {
      stats.goalCategories[cat] = (stats.goalCategories[cat] ?? 0) + count;
    }

    // Friction
    for (const [type, count] of Object.entries(f.friction_counts)) {
      if (count > 0) {
        stats.frictionCounts[type] = (stats.frictionCounts[type] ?? 0) + count;
      }
    }

    // Satisfaction
    stats.satisfactionBreakdown[f.user_satisfaction] = (stats.satisfactionBreakdown[f.user_satisfaction] ?? 0) + 1;

    // Project
    const projName = f.project_path ? path.basename(f.project_path) : "unknown";
    stats.projectBreakdown[projName] = (stats.projectBreakdown[projName] ?? 0) + 1;
  }

  return stats;
}

// ── AI Insight rounds ─────────────────────────────────────────────────

export interface InsightsResult {
  stats: AggregatedStats;
  projectAreas: string;
  interactionStyle: string;
  whatWorks: string;
  frictionAnalysis: string;
  suggestions: string;
  atAGlance: string;
}

const INSIGHT_PROMPTS = {
  projectAreas: (stats: string, sampleFacets: string) => `Based on these aggregated usage statistics and sample session facets from multiple AI coding CLI tools (Claude Code, Codex, etc.), identify 4-5 distinct work areas/domains the user focuses on. For each, describe what kind of work they do and roughly what proportion of their time goes there.

Stats: ${stats}

Sample facets: ${sampleFacets}

Write 4-5 short paragraphs. No JSON, just natural language.`,

  interactionStyle: (stats: string, sampleFacets: string) => `Based on these usage statistics and session facets across multiple AI CLI tools, describe how this user interacts with AI coding assistants. Consider: session length patterns, single vs multi-task tendencies, how they phrase requests, tool preferences (Claude vs Codex), and any notable habits.

Stats: ${stats}

Sample facets: ${sampleFacets}

Write 2-3 paragraphs of natural language analysis.`,

  whatWorks: (stats: string, sampleFacets: string) => `Based on these statistics and session facets, identify 3 workflows or patterns where the user gets the best results from AI coding tools. For each, explain what makes it work well.

Stats: ${stats}

Sample facets: ${sampleFacets}

Write 3 short sections with a bold title each.`,

  frictionAnalysis: (stats: string, sampleFacets: string) => `Based on these statistics and session facets, identify the top 3 friction points where things go wrong when the user works with AI coding tools. For each friction point, describe the pattern and suggest how to avoid it.

Stats: ${stats}

Sample facets: ${sampleFacets}

Write 3 short sections with a bold title each.`,

  suggestions: (stats: string, sampleFacets: string) => `Based on these statistics and session facets, suggest 3-5 actionable improvements the user could make to get more value from their AI coding tools (Claude Code, Codex, etc.). Include both workflow changes and tool features they might not be using.

Stats: ${stats}

Sample facets: ${sampleFacets}

Write 3-5 concise bullet points.`,

  atAGlance: (stats: string, insights: string) => `Based on the following usage statistics and analysis of a user's AI coding tool usage across Claude Code and Codex, write a concise "At a Glance" summary with these 4 sections:

1. **What's working** — The user's unique strengths and successful patterns
2. **What's hindering you** — Pain points from both the AI side and user habits
3. **Quick wins to try** — Specific, actionable things to try this week
4. **Ambitious workflows** — Bigger patterns that could significantly boost productivity

Stats: ${stats}

Previous analysis: ${insights}

Write 4 sections, each 2-3 sentences. Keep it direct and personal.`,
};

export async function runInsightRounds(
  stats: AggregatedStats,
  facets: SessionFacet[],
  cliSpec: { file: string; env: Record<string, string> },
  cliTool: "claude" | "codex",
  onProgress: (p: InsightsProgress) => void,
): Promise<InsightsResult | InsightsError> {
  const statsStr = JSON.stringify(stats, null, 2);
  // Take a sample of up to 30 facets for the prompts
  const sampleFacets = JSON.stringify(facets.slice(0, 30).map((f) => ({
    goal: f.underlying_goal,
    summary: f.brief_summary,
    outcome: f.outcome,
    type: f.session_type,
    tool: f.cli_tool,
    friction: f.friction_counts,
    project: path.basename(f.project_path || "unknown"),
  })), null, 2);

  const rounds = ["projectAreas", "interactionStyle", "whatWorks", "frictionAnalysis", "suggestions"] as const;
  const results: Record<string, string> = {};

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    onProgress({
      stage: "analyzing",
      current: i + 1,
      total: rounds.length + 1, // +1 for atAGlance
      message: `Running analysis: ${round}...`,
    });

    const prompt = INSIGHT_PROMPTS[round](statsStr, sampleFacets);
    try {
      results[round] = await invokeCli(cliSpec, cliTool, prompt, 120_000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { code: "cli_error", message: `Analysis round "${round}" failed`, detail: msg };
    }
  }

  // At a Glance (final round)
  onProgress({
    stage: "analyzing",
    current: rounds.length + 1,
    total: rounds.length + 1,
    message: "Generating summary...",
  });

  const allInsights = Object.entries(results).map(([k, v]) => `## ${k}\n${v}`).join("\n\n");
  let atAGlance: string;
  try {
    atAGlance = await invokeCli(
      cliSpec,
      cliTool,
      INSIGHT_PROMPTS.atAGlance(statsStr, allInsights),
      120_000,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { code: "cli_error", message: "At a Glance generation failed", detail: msg };
  }

  return {
    stats,
    projectAreas: results.projectAreas,
    interactionStyle: results.interactionStyle,
    whatWorks: results.whatWorks,
    frictionAnalysis: results.frictionAnalysis,
    suggestions: results.suggestions,
    atAGlance,
  };
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep insights`
Expected: no errors

**Step 3: Commit**

```bash
git add electron/insights-engine.ts
git commit -m "feat(insights): add aggregation and AI insight rounds"
```

---

### Task 5: HTML Report Generator

Generate a self-contained HTML report from the insights data.

**Files:**
- Create: `electron/insights-report.ts`

**Step 1: Write the HTML report generator**

```typescript
// electron/insights-report.ts
import fs from "fs";
import path from "path";
import { TERMCANVAS_DIR } from "./state-persistence";
import type { AggregatedStats, InsightsResult } from "./insights-engine";

const REPORTS_DIR = path.join(TERMCANVAS_DIR, "insights-reports");

function ensureReportsDir(): void {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert markdown-ish text to simple HTML (bold, paragraphs, bullets). */
function markdownToHtml(text: string): string {
  return text
    .split("\n\n")
    .map((block) => {
      block = block.trim();
      if (!block) return "";
      // Bullet lists
      if (block.match(/^[-*•]\s/m)) {
        const items = block.split(/\n/).map((line) =>
          `<li>${escapeHtml(line.replace(/^[-*•]\s*/, "")).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`
        ).join("");
        return `<ul>${items}</ul>`;
      }
      // Headings
      if (block.startsWith("## ")) {
        return `<h2>${escapeHtml(block.slice(3)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</h2>`;
      }
      if (block.startsWith("# ")) {
        return `<h1>${escapeHtml(block.slice(2))}</h1>`;
      }
      // Paragraph with bold support
      const html = escapeHtml(block).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      return `<p>${html}</p>`;
    })
    .join("\n");
}

function progressBar(value: number, total: number, color: string): string {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${color}"></div><span class="progress-label">${value} (${pct}%)</span></div>`;
}

function breakdownSection(title: string, data: Record<string, number>, color: string): string {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (total === 0) return "";
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const rows = sorted.map(([key, val]) =>
    `<div class="breakdown-row"><span class="breakdown-label">${escapeHtml(key)}</span>${progressBar(val, total, color)}</div>`
  ).join("");
  return `<div class="section"><h2>${escapeHtml(title)}</h2>${rows}</div>`;
}

export function generateReport(insights: InsightsResult): string {
  ensureReportsDir();

  const { stats } = insights;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `insights-${timestamp}.html`;
  const filePath = path.join(REPORTS_DIR, fileName);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TermCanvas Insights Report</title>
<style>
  :root {
    --bg: #0a0a0b;
    --surface: #141416;
    --border: #2a2a2e;
    --text: #e4e4e7;
    --text-muted: #a1a1aa;
    --text-faint: #71717a;
    --accent: #6366f1;
    --green: #22c55e;
    --yellow: #eab308;
    --red: #ef4444;
    --cyan: #06b6d4;
    --purple: #a855f7;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 2rem;
    max-width: 860px;
    margin: 0 auto;
  }
  h1 {
    font-size: 1.8rem;
    font-weight: 700;
    margin-bottom: 0.5rem;
    background: linear-gradient(135deg, var(--accent), var(--purple));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .subtitle {
    color: var(--text-faint);
    font-size: 0.85rem;
    margin-bottom: 2rem;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }
  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }
  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    font-family: "SF Mono", "Fira Code", monospace;
  }
  .stat-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 0.25rem;
  }
  .section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .section h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--text);
  }
  .section p, .section li {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
  }
  .section ul {
    list-style: none;
    padding: 0;
  }
  .section ul li::before {
    content: "→ ";
    color: var(--accent);
  }
  .section strong {
    color: var(--text);
  }
  .progress-bar {
    flex: 1;
    height: 20px;
    background: var(--bg);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  }
  .progress-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s;
  }
  .progress-label {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.7rem;
    color: var(--text);
    font-family: "SF Mono", monospace;
  }
  .breakdown-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .breakdown-label {
    width: 140px;
    flex-shrink: 0;
    font-size: 0.8rem;
    color: var(--text-muted);
    text-transform: capitalize;
    font-family: "SF Mono", monospace;
  }
  .glance-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  @media (max-width: 600px) {
    .glance-grid { grid-template-columns: 1fr; }
    body { padding: 1rem; }
  }
  .footer {
    text-align: center;
    color: var(--text-faint);
    font-size: 0.75rem;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
</style>
</head>
<body>
<h1>TermCanvas Insights</h1>
<p class="subtitle">Generated on ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · ${stats.totalSessions} sessions analyzed</p>

<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-value">${stats.totalSessions}</div>
    <div class="stat-label">Sessions Analyzed</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${stats.totalMessages}</div>
    <div class="stat-label">Total Messages</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${Math.round(stats.totalDurationMinutes / 60)}h</div>
    <div class="stat-label">Total Time</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${Object.keys(stats.cliBreakdown).length}</div>
    <div class="stat-label">CLI Tools Used</div>
  </div>
</div>

<div class="section">
  <h2>At a Glance</h2>
  ${markdownToHtml(insights.atAGlance)}
</div>

${breakdownSection("CLI Tools", stats.cliBreakdown, "var(--accent)")}
${breakdownSection("Outcomes", stats.outcomeBreakdown, "var(--green)")}
${breakdownSection("Session Types", stats.sessionTypeBreakdown, "var(--cyan)")}
${breakdownSection("Goal Categories", stats.goalCategories, "var(--purple)")}
${breakdownSection("Friction Points", stats.frictionCounts, "var(--red)")}
${breakdownSection("Projects", stats.projectBreakdown, "var(--yellow)")}

<div class="section">
  <h2>What You Work On</h2>
  ${markdownToHtml(insights.projectAreas)}
</div>

<div class="section">
  <h2>How You Use These Tools</h2>
  ${markdownToHtml(insights.interactionStyle)}
</div>

<div class="section">
  <h2>What Works Well</h2>
  ${markdownToHtml(insights.whatWorks)}
</div>

<div class="section">
  <h2>Where Things Go Wrong</h2>
  ${markdownToHtml(insights.frictionAnalysis)}
</div>

<div class="section">
  <h2>Suggestions</h2>
  ${markdownToHtml(insights.suggestions)}
</div>

<div class="footer">
  Generated by TermCanvas · Cross-CLI Insights Engine
</div>
</body>
</html>`;

  fs.writeFileSync(filePath, html, "utf-8");
  return filePath;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep insights`
Expected: no errors

**Step 3: Commit**

```bash
git add electron/insights-report.ts
git commit -m "feat(insights): add HTML report generator"
```

---

### Task 6: Main Pipeline Orchestrator

Wire everything together into a single `generateInsights()` function that runs the full pipeline and is callable from IPC.

**Files:**
- Modify: `electron/insights-engine.ts`

**Step 1: Add the main pipeline function**

Append to `electron/insights-engine.ts`:

```typescript
export async function generateInsights(
  cliTool: "claude" | "codex",
  onProgress: (p: InsightsProgress) => void,
): Promise<{ ok: true; reportPath: string } | { ok: false; error: InsightsError }> {
  // 1. Validate CLI
  onProgress({ stage: "validating", current: 0, total: 0, message: `Validating ${cliTool} CLI...` });
  const validation = await validateCli(cliTool);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const cliSpec = await resolveCliSpec(cliTool);

  // 2. Scan sessions
  onProgress({ stage: "scanning", current: 0, total: 0, message: "Scanning session files..." });
  const sessions = scanAllSessions();

  if (sessions.length === 0) {
    return {
      ok: false,
      error: { code: "cli_error", message: "No valid sessions found to analyze." },
    };
  }

  // 3. Extract facets (batched, 10 at a time)
  const BATCH_SIZE = 10;
  const facets: SessionFacet[] = [];
  const errors: InsightsError[] = [];

  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);
    onProgress({
      stage: "extracting_facets",
      current: Math.min(i + BATCH_SIZE, sessions.length),
      total: sessions.length,
      message: `Analyzing session ${Math.min(i + BATCH_SIZE, sessions.length)}/${sessions.length}...`,
    });

    const results = await Promise.all(
      batch.map((s) => extractFacet(s, cliSpec, cliTool)),
    );

    for (const result of results) {
      if ("session_id" in result) {
        facets.push(result);
      } else {
        errors.push(result);
      }
    }
  }

  if (facets.length === 0) {
    return {
      ok: false,
      error: {
        code: "cli_error",
        message: `All ${sessions.length} sessions failed to analyze.`,
        detail: errors.map((e) => e.message).join("\n"),
      },
    };
  }

  // 4. Aggregate
  onProgress({ stage: "aggregating", current: 0, total: 0, message: "Aggregating statistics..." });
  const stats = aggregateFacets(facets, sessions);

  // 5. AI insight rounds
  const insightsResult = await runInsightRounds(stats, facets, cliSpec, cliTool, onProgress);
  if ("code" in insightsResult) {
    return { ok: false, error: insightsResult };
  }

  // 6. Generate HTML report
  onProgress({ stage: "generating_report", current: 0, total: 0, message: "Generating HTML report..." });

  // Import here to avoid circular dependency issues
  const { generateReport } = await import("./insights-report");
  const reportPath = generateReport(insightsResult);

  return { ok: true, reportPath };
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep insights`
Expected: no errors

**Step 3: Commit**

```bash
git add electron/insights-engine.ts
git commit -m "feat(insights): add main pipeline orchestrator"
```

---

### Task 7: IPC Wiring

Register the IPC handlers in main.ts and expose them via preload.ts.

**Files:**
- Modify: `electron/main.ts` — add IPC handler for `insights:generate`
- Modify: `electron/preload.ts` — expose `insights` namespace

**Step 1: Add IPC handler in main.ts**

After the existing usage handlers (around line 639), add:

```typescript
  // Insights
  ipcMain.handle("insights:generate", async (_event, cliTool: "claude" | "codex") => {
    const { generateInsights } = await import("./insights-engine");
    return generateInsights(cliTool, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("insights:progress", progress);
      }
    });
  });
```

Add the import for `shell` usage (already imported at line 1). After the handler returns successfully, the renderer will call `shell.openExternal`.

**Step 2: Add preload API**

In `electron/preload.ts`, add before the closing of `contextBridge.exposeInMainWorld`:

```typescript
  insights: {
    generate: (cliTool: "claude" | "codex") =>
      ipcRenderer.invoke("insights:generate", cliTool) as Promise<
        { ok: true; reportPath: string } | { ok: false; error: { code: string; message: string; detail?: string } }
      >,
    onProgress: (callback: (progress: { stage: string; current: number; total: number; message: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: { stage: string; current: number; total: number; message: string }) =>
        callback(progress);
      ipcRenderer.on("insights:progress", listener);
      return () => ipcRenderer.removeListener("insights:progress", listener);
    },
    openReport: (filePath: string) =>
      ipcRenderer.invoke("insights:open-report", filePath),
  },
```

**Step 3: Add the open-report handler in main.ts**

```typescript
  ipcMain.handle("insights:open-report", async (_event, filePath: string) => {
    const { shell } = await import("electron");
    await shell.openExternal(`file://${filePath}`);
  });
```

Wait — `shell` is already imported at the top of main.ts. Simplify:

```typescript
  ipcMain.handle("insights:open-report", async (_event, filePath: string) => {
    await shell.openExternal(`file://${filePath}`);
  });
```

**Step 4: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "main|preload|insights"`
Expected: no errors

**Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat(insights): wire IPC handlers and preload API"
```

---

### Task 8: Frontend — Insights Button in UsagePanel

Add the "Generate Insights" button with CLI selector, progress indicator, and error display to the UsagePanel.

**Files:**
- Create: `src/components/usage/InsightsButton.tsx`
- Modify: `src/components/UsagePanel.tsx` — import and render InsightsButton
- Modify: `src/i18n/en.ts` — add i18n keys
- Modify: `src/i18n/zh.ts` — add i18n keys

**Step 1: Add i18n keys**

In `src/i18n/en.ts`, add after the existing `usage_*` keys:

```typescript
  insights_generate: "Generate Insights",
  insights_select_cli: "Analyze with",
  insights_validating: "Validating CLI...",
  insights_scanning: "Scanning sessions...",
  insights_extracting: "Analyzing sessions",
  insights_aggregating: "Aggregating data...",
  insights_analyzing: "Running AI analysis",
  insights_generating: "Generating report...",
  insights_done: "Report generated!",
  insights_open: "Open Report",
  insights_error: "Insights Error",
```

In `src/i18n/zh.ts`, add:

```typescript
  insights_generate: "生成洞察报告",
  insights_select_cli: "使用",
  insights_validating: "验证 CLI...",
  insights_scanning: "扫描会话...",
  insights_extracting: "分析会话",
  insights_aggregating: "汇总数据...",
  insights_analyzing: "AI 分析中",
  insights_generating: "生成报告...",
  insights_done: "报告已生成！",
  insights_open: "打开报告",
  insights_error: "洞察报告错误",
```

**Step 2: Create InsightsButton component**

```tsx
// src/components/usage/InsightsButton.tsx
import { useState, useEffect, useRef } from "react";
import { useT } from "../../i18n/useT";

type CliTool = "claude" | "codex";

interface Progress {
  stage: string;
  current: number;
  total: number;
  message: string;
}

export function InsightsButton() {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const handleGenerate = async (cliTool: CliTool) => {
    setShowPicker(false);
    setRunning(true);
    setError(null);
    setReportPath(null);
    setProgress({ stage: "validating", current: 0, total: 0, message: t.insights_validating });

    // Subscribe to progress events
    cleanupRef.current = window.termcanvas.insights.onProgress((p) => {
      setProgress(p);
    });

    try {
      const result = await window.termcanvas.insights.generate(cliTool);
      if (result.ok) {
        setReportPath(result.reportPath);
        setProgress(null);
        // Auto-open the report
        window.termcanvas.insights.openReport(result.reportPath);
      } else {
        setError({ message: result.error.message, detail: result.error.detail });
        setProgress(null);
      }
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : String(err) });
      setProgress(null);
    } finally {
      setRunning(false);
      cleanupRef.current?.();
      cleanupRef.current = null;
    }
  };

  const progressText = progress
    ? progress.total > 0
      ? `${progress.message} (${progress.current}/${progress.total})`
      : progress.message
    : null;

  return (
    <div className="px-3 py-2.5">
      {/* Error display */}
      {error && (
        <div className="mb-2 p-2 rounded-md bg-red-500/10 border border-red-500/20">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-red-400">{t.insights_error}</span>
            <button
              className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-muted)] cursor-pointer"
              onClick={() => setError(null)}
            >
              ✕
            </button>
          </div>
          <p className="text-[10px] text-red-400/80 mt-1">{error.message}</p>
          {error.detail && (
            <pre className="text-[9px] text-[var(--text-faint)] mt-1 whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
              {error.detail}
            </pre>
          )}
        </div>
      )}

      {/* Success message */}
      {reportPath && !running && (
        <div className="mb-2 p-2 rounded-md bg-green-500/10 border border-green-500/20">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-green-400">{t.insights_done}</span>
            <button
              className="text-[10px] text-green-400 hover:text-green-300 underline cursor-pointer"
              onClick={() => window.termcanvas.insights.openReport(reportPath)}
            >
              {t.insights_open}
            </button>
          </div>
        </div>
      )}

      {/* Progress */}
      {running && progressText && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-[11px] text-[var(--text-muted)]">{progressText}</span>
          </div>
          {progress && progress.total > 0 && (
            <div className="mt-1.5 h-1 rounded-full bg-[var(--border)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{
                  width: `${Math.round((progress.current / progress.total) * 100)}%`,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Button */}
      {!running && (
        <div className="relative">
          <button
            className="w-full py-1.5 px-3 rounded-md text-[11px] font-medium border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors duration-150 cursor-pointer"
            onClick={() => setShowPicker(!showPicker)}
          >
            {t.insights_generate}
          </button>

          {/* CLI picker dropdown */}
          {showPicker && (
            <div className="absolute bottom-full left-0 right-0 mb-1 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden z-10">
              {(["claude", "codex"] as const).map((tool) => (
                <button
                  key={tool}
                  className="w-full px-3 py-1.5 text-left text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)] hover:text-[var(--text-primary)] transition-colors duration-100 cursor-pointer"
                  onClick={() => handleGenerate(tool)}
                >
                  {t.insights_select_cli} {tool === "claude" ? "Claude" : "Codex"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Add InsightsButton to UsagePanel**

In `src/components/UsagePanel.tsx`, add import at the top:

```typescript
import { InsightsButton } from "./usage/InsightsButton";
```

Then in the JSX, after the last `<TokenHeatmap>` section and before the closing `</div>` of the content area (after the heatmap section around line 625), add:

```tsx
              <div className="mx-3 h-px bg-[var(--border)]" />
              <div className="usage-section-enter" style={{ animationDelay: "300ms" }}>
                <InsightsButton />
              </div>
```

**Step 4: Add `window.termcanvas.insights` type declaration**

Find where the `window.termcanvas` type is declared (likely in a `.d.ts` or `types` file) and add the insights namespace. If there's no global type declaration, we can skip this for now — TypeScript will infer from the preload.

**Step 5: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: no errors (or only pre-existing ones)

**Step 6: Commit**

```bash
git add src/components/usage/InsightsButton.tsx src/components/UsagePanel.tsx src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat(insights): add Insights button with CLI picker, progress, and error display"
```

---

### Task 9: Type Declarations for window.termcanvas.insights

Ensure TypeScript knows about the new `insights` API on `window.termcanvas`.

**Files:**
- Search for existing `window.termcanvas` type declaration and modify it

**Step 1: Find the type declaration**

Search for `termcanvas` type declaration in `.d.ts` files or in `src/types/`. If none exists, the preload types may be inferred. In that case, create a small ambient declaration.

Check `src/vite-env.d.ts` or `src/global.d.ts` or `src/types/electron.d.ts`.

If no existing declaration is found, create `src/types/termcanvas.d.ts`:

```typescript
// Extend the window.termcanvas object with insights API
interface TermcanvasInsightsApi {
  generate: (cliTool: "claude" | "codex") => Promise<
    { ok: true; reportPath: string } | { ok: false; error: { code: string; message: string; detail?: string } }
  >;
  onProgress: (callback: (progress: { stage: string; current: number; total: number; message: string }) => void) => () => void;
  openReport: (filePath: string) => Promise<void>;
}

declare global {
  interface Window {
    termcanvas: {
      // ...existing properties are already typed elsewhere or inferred...
      insights: TermcanvasInsightsApi;
    } & Record<string, unknown>;
  }
}

export {};
```

Note: This depends on how the project currently handles `window.termcanvas` types. Check the existing pattern and follow it.

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/types/termcanvas.d.ts  # or wherever it was added
git commit -m "feat(insights): add TypeScript declarations for insights API"
```

---

### Task 10: Manual Integration Test

Verify the full pipeline works end-to-end.

**Step 1: Build and run**

Run: `npm run build && npm run dev` (or the project's dev command)

**Step 2: Verify**

1. Open the Usage panel (right side)
2. Scroll to the bottom — "Generate Insights" button should be visible
3. Click it — CLI picker dropdown should appear
4. Select "Claude" — should show progress stages
5. On completion — HTML report should auto-open in browser
6. Report should contain all sections with real data

**Step 3: Test error cases**

1. Try selecting a CLI that's not installed → should show clear error
2. If possible, test with expired auth → should show the error from the CLI

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(insights): integration test fixes"
```
