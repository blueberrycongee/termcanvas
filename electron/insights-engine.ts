import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { findClaudeJsonlFiles, findCodexJsonlFiles } from "./usage-collector";
import { TERMCANVAS_DIR } from "./state-persistence";
import { buildLaunchSpec, PtyResolvedLaunchSpec } from "./pty-launch";

// ── Section A: Session Content Extraction ───────────────────────────────

export interface SessionInfo {
  id: string;
  filePath: string;
  cliTool: "claude" | "codex";
  projectPath: string;
  messageCount: number;
  durationMinutes: number;
  contentSummary: string;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (b) =>
          b &&
          typeof b === "object" &&
          (b as Record<string, unknown>).type === "text",
      )
      .map((b) => (b as Record<string, unknown>).text as string)
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function extractClaudeSession(filePath: string): SessionInfo | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  let projectPath = "";
  const rel = path.relative(projectsDir, filePath);
  const topDir = rel.split(path.sep)[0];
  if (topDir && topDir.startsWith("-")) {
    const cleaned = topDir.replace(/--worktrees-.*$/, "");
    projectPath = cleaned.replace(/-/g, "/");
  }

  const timestamps: number[] = [];
  let messageCount = 0;
  const parts: string[] = [];

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = obj.timestamp;
    if (typeof ts === "string") {
      const ms = new Date(ts).getTime();
      if (!isNaN(ms)) timestamps.push(ms);
    }

    const msg = obj.message;
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    const role = m.role as string | undefined;
    if (role !== "user" && role !== "assistant") continue;

    messageCount++;
    const text = extractTextFromContent(m.content);
    if (text) parts.push(`${role}: ${text}`);
  }

  if (messageCount < 2) return null;
  const durationMinutes =
    timestamps.length >= 2
      ? (Math.max(...timestamps) - Math.min(...timestamps)) / 60_000
      : 0;
  if (durationMinutes < 1) return null;

  return {
    id: path.basename(filePath, ".jsonl"),
    filePath,
    cliTool: "claude",
    projectPath,
    messageCount,
    durationMinutes: Math.round(durationMinutes),
    contentSummary: parts.join("\n").slice(0, 4000),
  };
}

function extractCodexSession(filePath: string): SessionInfo | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  let projectPath = "";
  const timestamps: number[] = [];
  let messageCount = 0;
  const parts: string[] = [];

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = obj.timestamp;
    if (typeof ts === "string") {
      const ms = new Date(ts).getTime();
      if (!isNaN(ms)) timestamps.push(ms);
    }

    if (obj.type === "session_meta") {
      const payload = obj.payload as Record<string, unknown> | undefined;
      if (payload?.cwd) projectPath = payload.cwd as string;
      continue;
    }

    if (obj.type !== "event_msg") continue;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    const pType = payload.type as string | undefined;
    let role: "user" | "assistant" | null = null;
    if (pType === "user_message" || pType === "input_text") role = "user";
    else if (pType === "assistant_message" || pType === "message")
      role = "assistant";
    if (!role) continue;

    messageCount++;
    const text =
      (payload.text as string) ?? (payload.content as string) ?? "";
    if (text) parts.push(`${role}: ${text}`);
  }

  if (messageCount < 2) return null;
  const durationMinutes =
    timestamps.length >= 2
      ? (Math.max(...timestamps) - Math.min(...timestamps)) / 60_000
      : 0;
  if (durationMinutes < 1) return null;

  return {
    id: path.basename(filePath, ".jsonl"),
    filePath,
    cliTool: "codex",
    projectPath,
    messageCount,
    durationMinutes: Math.round(durationMinutes),
    contentSummary: parts.join("\n").slice(0, 4000),
  };
}

// ── Section B: Session Scanning ─────────────────────────────────────────

export function scanAllSessions(): SessionInfo[] {
  const sessions: SessionInfo[] = [];

  for (const f of findClaudeJsonlFiles()) {
    const session = extractClaudeSession(f);
    if (session) sessions.push(session);
  }

  for (const f of findCodexJsonlFiles()) {
    const session = extractCodexSession(f);
    if (session) sessions.push(session);
  }

  return sessions;
}

// ── Section C: Facet Types and Cache ────────────────────────────────────

export interface SessionFacet {
  session_id: string;
  cli_tool: "claude" | "codex";
  underlying_goal: string;
  brief_summary: string;
  goal_categories: Record<string, number>;
  outcome:
    | "fully_achieved"
    | "mostly_achieved"
    | "partially_achieved"
    | "not_achieved"
    | "unclear";
  session_type:
    | "single_task"
    | "multi_task"
    | "iterative"
    | "exploratory"
    | "quick_question";
  friction_counts: Record<string, number>;
  user_satisfaction: "high" | "medium" | "low" | "unclear";
  project_path: string;
}

export interface InsightsProgress {
  stage:
    | "validating"
    | "scanning"
    | "extracting_facets"
    | "aggregating"
    | "analyzing"
    | "generating_report";
  current: number;
  total: number;
  message: string;
}

export interface InsightsError {
  code:
    | "cli_not_found"
    | "auth_failed"
    | "cli_error"
    | "parse_error"
    | "unknown";
  message: string;
  detail?: string;
}

const FACET_CACHE_DIR = path.join(
  TERMCANVAS_DIR,
  "insights-cache",
  "facets",
);

function readCachedFacet(sessionId: string): SessionFacet | null {
  try {
    const raw = fs.readFileSync(
      path.join(FACET_CACHE_DIR, `${sessionId}.json`),
      "utf-8",
    );
    return JSON.parse(raw) as SessionFacet;
  } catch {
    return null;
  }
}

function writeCachedFacet(sessionId: string, facet: SessionFacet): void {
  try {
    fs.mkdirSync(FACET_CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(FACET_CACHE_DIR, `${sessionId}.json`),
      JSON.stringify(facet, null, 2),
    );
  } catch {
    /* non-fatal */
  }
}

// ── Section D: CLI Invocation ───────────────────────────────────────────

async function resolveCliSpec(
  cliTool: "claude" | "codex",
): Promise<PtyResolvedLaunchSpec> {
  return buildLaunchSpec({ cwd: process.cwd(), shell: cliTool });
}

async function invokeCli(
  spec: PtyResolvedLaunchSpec,
  cliTool: "claude" | "codex",
  prompt: string,
  timeoutMs = 120_000,
): Promise<string> {
  const args =
    cliTool === "claude"
      ? ["--print", "-p", prompt]
      : ["exec", prompt];

  return new Promise<string>((resolve, reject) => {
    execFile(
      spec.file,
      args,
      {
        cwd: spec.cwd,
        env: spec.env,
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function validateCli(
  cliTool: "claude" | "codex",
): Promise<InsightsError | null> {
  let spec: PtyResolvedLaunchSpec;
  try {
    spec = await resolveCliSpec(cliTool);
  } catch {
    return {
      code: "cli_not_found",
      message: `${cliTool} CLI not found in PATH`,
    };
  }

  try {
    const response = await invokeCli(
      spec,
      cliTool,
      "Reply with exactly: OK",
      15_000,
    );
    if (!response.includes("OK")) {
      return {
        code: "auth_failed",
        message: `${cliTool} CLI responded but did not return expected output — authentication may have failed`,
        detail: response.slice(0, 500),
      };
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("auth") ||
      msg.includes("401") ||
      msg.includes("API key")
    ) {
      return {
        code: "auth_failed",
        message: `${cliTool} authentication failed`,
        detail: msg,
      };
    }
    return {
      code: "cli_error",
      message: `${cliTool} CLI invocation failed`,
      detail: msg,
    };
  }
}

function parseJsonFromResponse(
  response: string,
): Record<string, unknown> | null {
  const cleaned = response.replace(/```(?:json)?\s*/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const FACET_REQUIRED_FIELDS = [
  "session_id",
  "cli_tool",
  "underlying_goal",
  "brief_summary",
  "outcome",
  "session_type",
  "user_satisfaction",
  "project_path",
] as const;

export async function extractFacet(
  session: SessionInfo,
  cliSpec: PtyResolvedLaunchSpec,
  cliTool: "claude" | "codex",
): Promise<SessionFacet | InsightsError> {
  const cached = readCachedFacet(session.id);
  if (cached) return cached;

  const prompt = [
    "Analyze this AI coding session and return a JSON object with exactly these fields:",
    `- session_id: "${session.id}"`,
    `- cli_tool: "${session.cliTool}"`,
    "- underlying_goal: string describing what the user was trying to achieve",
    "- brief_summary: 1-2 sentence summary",
    '- goal_categories: object mapping category names (e.g. "bug_fix","feature","refactor","test","docs","config") to confidence 0-1',
    '- outcome: one of "fully_achieved","mostly_achieved","partially_achieved","not_achieved","unclear"',
    '- session_type: one of "single_task","multi_task","iterative","exploratory","quick_question"',
    '- friction_counts: object mapping friction types (e.g. "misunderstanding","error","retry","confusion") to counts',
    '- user_satisfaction: one of "high","medium","low","unclear"',
    `- project_path: "${session.projectPath}"`,
    "",
    "Session transcript (truncated):",
    session.contentSummary,
    "",
    "Return ONLY a valid JSON object. No markdown fences, no explanation.",
  ].join("\n");

  let response: string;
  try {
    response = await invokeCli(cliSpec, cliTool, prompt);
  } catch (err) {
    return {
      code: "cli_error",
      message: `Failed to extract facet for session ${session.id}`,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const parsed = parseJsonFromResponse(response);
  if (!parsed) {
    return {
      code: "parse_error",
      message: `No JSON object found in response for session ${session.id}`,
      detail: response.slice(0, 500),
    };
  }

  for (const field of FACET_REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      return {
        code: "parse_error",
        message: `Missing required field "${field}" in facet for session ${session.id}`,
      };
    }
  }

  if (!parsed.goal_categories || typeof parsed.goal_categories !== "object") {
    parsed.goal_categories = {};
  }
  if (!parsed.friction_counts || typeof parsed.friction_counts !== "object") {
    parsed.friction_counts = {};
  }

  const facet = parsed as unknown as SessionFacet;
  writeCachedFacet(session.id, facet);
  return facet;
}

// ── Section E: Aggregation ──────────────────────────────────────────────

export interface AggregatedStats {
  totalSessions: number;
  totalMessages: number;
  totalDurationMinutes: number;
  cliBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;
  sessionTypeBreakdown: Record<string, number>;
  goalCategories: Record<string, number>;
  frictionCounts: Record<string, number>;
  satisfactionBreakdown: Record<string, number>;
  projectBreakdown: Record<string, number>;
}

function incr(map: Record<string, number>, key: string, amount = 1): void {
  map[key] = (map[key] ?? 0) + amount;
}

export function aggregateFacets(
  facets: SessionFacet[],
  sessions: SessionInfo[],
): AggregatedStats {
  const stats: AggregatedStats = {
    totalSessions: sessions.length,
    totalMessages: sessions.reduce((s, x) => s + x.messageCount, 0),
    totalDurationMinutes: sessions.reduce((s, x) => s + x.durationMinutes, 0),
    cliBreakdown: {},
    outcomeBreakdown: {},
    sessionTypeBreakdown: {},
    goalCategories: {},
    frictionCounts: {},
    satisfactionBreakdown: {},
    projectBreakdown: {},
  };

  for (const f of facets) {
    incr(stats.cliBreakdown, f.cli_tool);
    incr(stats.outcomeBreakdown, f.outcome);
    incr(stats.sessionTypeBreakdown, f.session_type);
    incr(stats.satisfactionBreakdown, f.user_satisfaction);
    incr(
      stats.projectBreakdown,
      f.project_path ? path.basename(f.project_path) : "unknown",
    );

    for (const [cat, weight] of Object.entries(f.goal_categories)) {
      incr(stats.goalCategories, cat, weight);
    }
    for (const [type, count] of Object.entries(f.friction_counts)) {
      incr(stats.frictionCounts, type, count);
    }
  }

  return stats;
}

// ── Section F: AI Insight Rounds ────────────────────────────────────────

export interface InsightsResult {
  stats: AggregatedStats;
  projectAreas: string;
  interactionStyle: string;
  whatWorks: string;
  frictionAnalysis: string;
  suggestions: string;
  atAGlance: string;
}

function isInsightsError(
  val: InsightsResult | InsightsError,
): val is InsightsError {
  return "code" in val;
}

async function runInsightRounds(
  cliSpec: PtyResolvedLaunchSpec,
  cliTool: "claude" | "codex",
  stats: AggregatedStats,
  facets: SessionFacet[],
  onProgress: (p: InsightsProgress) => void,
): Promise<InsightsResult | InsightsError> {
  const sampleFacets = facets.slice(0, 30);
  const dataCtx = [
    "Statistics:",
    JSON.stringify(stats, null, 2),
    "",
    `Sample session facets (${sampleFacets.length} of ${facets.length}):`,
    JSON.stringify(sampleFacets, null, 2),
  ].join("\n");

  const rounds: { key: string; instruction: string }[] = [
    {
      key: "projectAreas",
      instruction:
        "Analyze the PROJECT AREAS the user works on. Identify key projects, their relative importance, and how they relate.",
    },
    {
      key: "interactionStyle",
      instruction:
        "Analyze the user's INTERACTION STYLE with AI coding assistants. How they phrase requests, iterate vs complete specs, hands-on vs delegating.",
    },
    {
      key: "whatWorks",
      instruction:
        "Analyze WHAT WORKS WELL. Which task types succeed most? What patterns lead to high satisfaction and good outcomes?",
    },
    {
      key: "frictionAnalysis",
      instruction:
        "Analyze FRICTION POINTS. What causes sessions to fail or underperform? Where does AI-human collaboration break down?",
    },
    {
      key: "suggestions",
      instruction:
        "Provide ACTIONABLE SUGGESTIONS to improve the AI coding workflow. Be specific, practical, and grounded in the data.",
    },
  ];

  const texts: Record<string, string> = {};

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    onProgress({
      stage: "analyzing",
      current: i + 1,
      total: rounds.length + 1,
      message: `Analyzing: ${round.key}`,
    });

    try {
      const resp = await invokeCli(
        cliSpec,
        cliTool,
        `${round.instruction}\n\n${dataCtx}`,
      );
      texts[round.key] = resp.trim();
    } catch (err) {
      return {
        code: "cli_error",
        message: `Insight round "${round.key}" failed`,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Final at-a-glance round
  onProgress({
    stage: "analyzing",
    current: rounds.length + 1,
    total: rounds.length + 1,
    message: "Generating at-a-glance summary",
  });

  const summaryCtx = Object.entries(texts)
    .map(([k, v]) => `${k}:\n${v}`)
    .join("\n\n");

  try {
    const resp = await invokeCli(
      cliSpec,
      cliTool,
      `Write a concise AT-A-GLANCE summary (3-5 bullet points) of the user's AI coding usage patterns, strengths, and areas for improvement.\n\n${summaryCtx}`,
    );
    texts.atAGlance = resp.trim();
  } catch (err) {
    return {
      code: "cli_error",
      message: "At-a-glance round failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    stats,
    projectAreas: texts.projectAreas ?? "",
    interactionStyle: texts.interactionStyle ?? "",
    whatWorks: texts.whatWorks ?? "",
    frictionAnalysis: texts.frictionAnalysis ?? "",
    suggestions: texts.suggestions ?? "",
    atAGlance: texts.atAGlance ?? "",
  };
}

// ── Section G: Main Pipeline ────────────────────────────────────────────

export async function generateInsights(
  cliTool: "claude" | "codex",
  onProgress: (p: InsightsProgress) => void,
): Promise<{ ok: true; reportPath: string } | { ok: false; error: InsightsError }> {
  // 1. Validate CLI
  onProgress({
    stage: "validating",
    current: 0,
    total: 1,
    message: `Validating ${cliTool} CLI...`,
  });
  const validationErr = await validateCli(cliTool);
  if (validationErr) return { ok: false, error: validationErr };

  let cliSpec: PtyResolvedLaunchSpec;
  try {
    cliSpec = await resolveCliSpec(cliTool);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "cli_not_found",
        message: `Failed to resolve ${cliTool} CLI`,
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // 2. Scan sessions
  onProgress({
    stage: "scanning",
    current: 0,
    total: 1,
    message: "Scanning session files...",
  });
  const sessions = scanAllSessions();
  if (sessions.length === 0) {
    return {
      ok: false,
      error: { code: "unknown", message: "No valid sessions found to analyze" },
    };
  }

  // 3. Extract facets in batches of 10
  const facets: SessionFacet[] = [];
  for (let i = 0; i < sessions.length; i += 10) {
    const batch = sessions.slice(i, i + 10);
    onProgress({
      stage: "extracting_facets",
      current: i,
      total: sessions.length,
      message: `Extracting facets: ${i}/${sessions.length}`,
    });
    const results = await Promise.all(
      batch.map((s) => extractFacet(s, cliSpec, cliTool)),
    );
    for (const r of results) {
      if ("session_id" in r) facets.push(r);
    }
  }

  if (facets.length === 0) {
    return {
      ok: false,
      error: {
        code: "unknown",
        message: "Failed to extract any session facets",
      },
    };
  }

  // 4. Aggregate
  onProgress({
    stage: "aggregating",
    current: 0,
    total: 1,
    message: "Aggregating statistics...",
  });
  const stats = aggregateFacets(facets, sessions);

  // 5. Insight rounds
  const insightsResult = await runInsightRounds(
    cliSpec,
    cliTool,
    stats,
    facets,
    onProgress,
  );
  if (isInsightsError(insightsResult)) return { ok: false, error: insightsResult };

  // 6. Generate report (dynamic import — module created separately)
  onProgress({
    stage: "generating_report",
    current: 0,
    total: 1,
    message: "Generating report...",
  });
  try {
    const mod = "./insights-report";
    const reportModule = (await import(mod)) as {
      generateReport: (result: InsightsResult) => Promise<string>;
    };
    const reportPath = await reportModule.generateReport(insightsResult);
    return { ok: true, reportPath };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "unknown",
        message: "Failed to generate report",
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
