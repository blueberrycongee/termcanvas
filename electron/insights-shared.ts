import crypto from "node:crypto";
import path from "node:path";

export type InsightsCliTool = "claude" | "codex";

export interface SessionMetrics {
  toolCounts: Record<string, number>;
  languages: Record<string, number>;
  modelCounts: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  gitCommits: number;
  gitPushes: number;
  filesModified: number;
  linesAdded: number;
  linesRemoved: number;
  toolErrorCategories: Record<string, number>;
  assistantResponseSeconds: number[];
  userReplySeconds: number[];
  userInterruptions: number;
  messageHours: Record<string, number>;
  featureUsage: Record<string, number>;
}

export interface SessionInfo {
  id: string;
  filePath: string;
  cliTool: InsightsCliTool;
  projectPath: string;
  startTimeMs: number;
  endTimeMs: number;
  messageCount: number;
  durationMinutes: number;
  contentSummary: string;
  analysisText: string;
  mtimeMs: number;
  fileSize: number;
  metrics: SessionMetrics;
}

export interface SessionFacet {
  session_id: string;
  cli_tool: InsightsCliTool;
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
  project_area: string;
  notable_tools: string[];
  dominant_languages: string[];
  wins: string[];
  frictions: string[];
  recommended_next_step: string;
}

export interface InsightsProgress {
  jobId: string;
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
    | "job_in_progress"
    | "unknown";
  message: string;
  detail?: string;
}

export interface InsightsPipelineCounts {
  sourceCli: InsightsCliTool;
  analyzerCli: InsightsCliTool;
  totalScannedSessions: number;
  totalEligibleSessions: number;
  cachedFacetSessions: number;
  failedFacetSessions: number;
  deferredFacetSessions: number;
}

export interface AggregatedStats extends InsightsPipelineCounts {
  totalSessions: number;
  totalMessages: number;
  totalDurationMinutes: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalReasoningTokens: number;
  totalGitCommits: number;
  totalGitPushes: number;
  totalFilesModified: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalUserInterruptions: number;
  averageAssistantResponseSeconds: number;
  averageUserReplySeconds: number;
  cliBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;
  sessionTypeBreakdown: Record<string, number>;
  goalCategories: Record<string, number>;
  frictionCounts: Record<string, number>;
  satisfactionBreakdown: Record<string, number>;
  projectBreakdown: Record<string, number>;
  projectAreaBreakdown: Record<string, number>;
  toolBreakdown: Record<string, number>;
  languageBreakdown: Record<string, number>;
  modelBreakdown: Record<string, number>;
  toolErrorBreakdown: Record<string, number>;
  messageHourBreakdown: Record<string, number>;
  responseTimeBreakdown: Record<string, number>;
  userReplyBreakdown: Record<string, number>;
  featureUsageBreakdown: Record<string, number>;
}

export interface InsightsProjectAreaCard {
  name: string;
  share: string;
  evidence: string;
  opportunities: string;
}

export interface InsightsProjectAreasSection {
  summary: string;
  areas: InsightsProjectAreaCard[];
}

export interface InsightsInteractionPattern {
  title: string;
  signal: string;
  impact: string;
  coaching: string;
}

export interface InsightsInteractionStyleSection {
  summary: string;
  patterns: InsightsInteractionPattern[];
}

export interface InsightsWinCard {
  title: string;
  evidence: string;
  whyItWorks: string;
  doMoreOf: string;
}

export interface InsightsWhatWorksSection {
  summary: string;
  wins: InsightsWinCard[];
}

export interface InsightsFrictionCard {
  title: string;
  severity: "high" | "medium" | "low";
  evidence: string;
  likelyCause: string;
  mitigation: string;
}

export interface InsightsFrictionSection {
  summary: string;
  issues: InsightsFrictionCard[];
}

export interface InsightsSuggestionCard {
  title: string;
  priority: "now" | "next" | "later";
  rationale: string;
  playbook: string;
  copyablePrompt: string;
}

export interface InsightsSuggestionsSection {
  summary: string;
  actions: InsightsSuggestionCard[];
}

export interface InsightsHorizonCard {
  title: string;
  whyNow: string;
  experiment: string;
  copyablePrompt: string;
}

export interface InsightsOnTheHorizonSection {
  summary: string;
  bets: InsightsHorizonCard[];
}

export interface InsightsFunEndingSection {
  title: string;
  moment: string;
  whyItMatters: string;
}

export interface InsightsAtAGlanceSection {
  headline: string;
  bullets: string[];
}

export type InsightsSectionKey =
  | "projectAreas"
  | "interactionStyle"
  | "whatWorks"
  | "frictionAnalysis"
  | "suggestions"
  | "onTheHorizon"
  | "funEnding"
  | "atAGlance";

export type InsightsSectionValueMap = {
  projectAreas: InsightsProjectAreasSection;
  interactionStyle: InsightsInteractionStyleSection;
  whatWorks: InsightsWhatWorksSection;
  frictionAnalysis: InsightsFrictionSection;
  suggestions: InsightsSuggestionsSection;
  onTheHorizon: InsightsOnTheHorizonSection;
  funEnding: InsightsFunEndingSection;
  atAGlance: InsightsAtAGlanceSection;
};

export interface InsightsResult {
  stats: AggregatedStats;
  projectAreas: InsightsProjectAreasSection | null;
  interactionStyle: InsightsInteractionStyleSection | null;
  whatWorks: InsightsWhatWorksSection | null;
  frictionAnalysis: InsightsFrictionSection | null;
  suggestions: InsightsSuggestionsSection | null;
  onTheHorizon: InsightsOnTheHorizonSection | null;
  funEnding: InsightsFunEndingSection | null;
  atAGlance: InsightsAtAGlanceSection;
  sectionErrors: Partial<Record<InsightsSectionKey, string>>;
}

export type InsightsGenerateResult =
  | { ok: true; jobId: string; reportPath: string }
  | { ok: false; jobId: string; error: InsightsError };

const SELF_INSIGHT_MARKERS = [
  "Analyze this AI coding session and return a JSON object",
  "RESPOND WITH ONLY A VALID JSON OBJECT",
  "Write a concise AT-A-GLANCE summary",
  "Analyze this Claude Code session and extract structured facets.",
];

export function createEmptySessionMetrics(): SessionMetrics {
  return {
    toolCounts: {},
    languages: {},
    modelCounts: {},
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    gitCommits: 0,
    gitPushes: 0,
    filesModified: 0,
    linesAdded: 0,
    linesRemoved: 0,
    toolErrorCategories: {},
    assistantResponseSeconds: [],
    userReplySeconds: [],
    userInterruptions: 0,
    messageHours: {},
    featureUsage: {},
  };
}

export function buildSessionFingerprint(
  session: Pick<SessionInfo, "cliTool" | "filePath" | "mtimeMs" | "fileSize">,
): string {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify([
        session.cliTool,
        path.resolve(session.filePath),
        session.mtimeMs,
        session.fileSize,
      ]),
    )
    .digest("hex");
}

export function isSelfInsightSession(content: string): boolean {
  return SELF_INSIGHT_MARKERS.some((marker) => content.includes(marker));
}

function incr(map: Record<string, number>, key: string, amount = 1): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + amount;
}

function averageRounded(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function responseBucket(seconds: number): string {
  if (seconds < 30) return "under_30s";
  if (seconds < 120) return "30s_to_2m";
  if (seconds < 600) return "2m_to_10m";
  return "over_10m";
}

function userReplyBucket(seconds: number): string {
  if (seconds < 120) return "under_2m";
  if (seconds < 600) return "2m_to_10m";
  if (seconds < 1_800) return "10m_to_30m";
  return "over_30m";
}

export function buildTranscriptWindow(parts: string[], maxChars = 12_000): string {
  const joined = parts.join("\n");
  if (joined.length <= maxChars) return joined;

  const marker = "\n[... transcript condensed ...]\n";
  const available = Math.max(maxChars - marker.length * 2, 90);
  const segmentBudget = Math.max(Math.floor(available / 3), 30);

  const takeFromStart = (items: string[]): string[] => {
    const kept: string[] = [];
    let used = 0;
    for (const item of items) {
      if (kept.length > 0 && used + item.length + 1 > segmentBudget) break;
      kept.push(item);
      used += item.length + 1;
    }
    return kept;
  };

  const takeFromEnd = (items: string[]): string[] => {
    const kept: string[] = [];
    let used = 0;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (kept.length > 0 && used + item.length + 1 > segmentBudget) break;
      kept.unshift(item);
      used += item.length + 1;
    }
    return kept;
  };

  const middleStart = Math.max(Math.floor(parts.length / 2) - 1, 0);
  const middleSlice = parts.slice(middleStart);

  const head = takeFromStart(parts).join("\n");
  const middle = takeFromStart(middleSlice).join("\n");
  const tail = takeFromEnd(parts).join("\n");

  return `${head}${marker}${middle}${marker}${tail}`;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map((item) => getString(item)).filter(Boolean) as string[];
  return items.length === value.length ? items : null;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseObjectArray<T>(
  value: unknown,
  parser: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parser);
  return parsed.every(Boolean) ? (parsed as T[]) : null;
}

function parseProjectAreaCard(value: unknown): InsightsProjectAreaCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const name = getString(obj.name);
  const share = getString(obj.share);
  const evidence = getString(obj.evidence);
  const opportunities = getString(obj.opportunities);
  return name && share && evidence && opportunities
    ? { name, share, evidence, opportunities }
    : null;
}

function parseInteractionPattern(value: unknown): InsightsInteractionPattern | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const signal = getString(obj.signal);
  const impact = getString(obj.impact);
  const coaching = getString(obj.coaching);
  return title && signal && impact && coaching
    ? { title, signal, impact, coaching }
    : null;
}

function parseWinCard(value: unknown): InsightsWinCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const evidence = getString(obj.evidence);
  const whyItWorks = getString(obj.whyItWorks);
  const doMoreOf = getString(obj.doMoreOf);
  return title && evidence && whyItWorks && doMoreOf
    ? { title, evidence, whyItWorks, doMoreOf }
    : null;
}

function parseFrictionCard(value: unknown): InsightsFrictionCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const evidence = getString(obj.evidence);
  const likelyCause = getString(obj.likelyCause);
  const mitigation = getString(obj.mitigation);
  const severity = obj.severity;
  return title &&
    evidence &&
    likelyCause &&
    mitigation &&
    (severity === "high" || severity === "medium" || severity === "low")
    ? { title, severity, evidence, likelyCause, mitigation }
    : null;
}

function parseSuggestionCard(value: unknown): InsightsSuggestionCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const rationale = getString(obj.rationale);
  const playbook = getString(obj.playbook);
  const copyablePrompt = getString(obj.copyablePrompt);
  const priority = obj.priority;
  return title &&
    rationale &&
    playbook &&
    copyablePrompt &&
    (priority === "now" || priority === "next" || priority === "later")
    ? { title, priority, rationale, playbook, copyablePrompt }
    : null;
}

function parseHorizonCard(value: unknown): InsightsHorizonCard | null {
  const obj = getObject(value);
  if (!obj) return null;
  const title = getString(obj.title);
  const whyNow = getString(obj.whyNow);
  const experiment = getString(obj.experiment);
  const copyablePrompt = getString(obj.copyablePrompt);
  return title && whyNow && experiment && copyablePrompt
    ? { title, whyNow, experiment, copyablePrompt }
    : null;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseStructuredSection<K extends InsightsSectionKey>(
  key: K,
  text: string,
): ParseResult<InsightsSectionValueMap[K]> {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return { ok: false, error: `No JSON object found for ${key}` };
  }

  const summary = getString(parsed.summary);
  switch (key) {
    case "projectAreas": {
      const areas = parseObjectArray(parsed.areas, parseProjectAreaCard);
      return summary && areas
        ? { ok: true, value: { summary, areas } as InsightsSectionValueMap[K] }
        : { ok: false, error: "projectAreas is missing summary or areas" };
    }
    case "interactionStyle": {
      const patterns = parseObjectArray(parsed.patterns, parseInteractionPattern);
      return summary && patterns
        ? { ok: true, value: { summary, patterns } as InsightsSectionValueMap[K] }
        : { ok: false, error: "interactionStyle is missing summary or patterns" };
    }
    case "whatWorks": {
      const wins = parseObjectArray(parsed.wins, parseWinCard);
      return summary && wins
        ? { ok: true, value: { summary, wins } as InsightsSectionValueMap[K] }
        : { ok: false, error: "whatWorks is missing summary or wins" };
    }
    case "frictionAnalysis": {
      const issues = parseObjectArray(parsed.issues, parseFrictionCard);
      return summary && issues
        ? { ok: true, value: { summary, issues } as InsightsSectionValueMap[K] }
        : { ok: false, error: "frictionAnalysis is missing summary or issues" };
    }
    case "suggestions": {
      const actions = parseObjectArray(parsed.actions, parseSuggestionCard);
      return summary && actions
        ? { ok: true, value: { summary, actions } as InsightsSectionValueMap[K] }
        : { ok: false, error: "suggestions is missing summary or actions" };
    }
    case "onTheHorizon": {
      const bets = parseObjectArray(parsed.bets, parseHorizonCard);
      return summary && bets
        ? { ok: true, value: { summary, bets } as InsightsSectionValueMap[K] }
        : { ok: false, error: "onTheHorizon is missing summary or bets" };
    }
    case "funEnding": {
      const title = getString(parsed.title);
      const moment = getString(parsed.moment);
      const whyItMatters = getString(parsed.whyItMatters);
      return title && moment && whyItMatters
        ? {
            ok: true,
            value: { title, moment, whyItMatters } as InsightsSectionValueMap[K],
          }
        : { ok: false, error: "funEnding is missing title, moment, or whyItMatters" };
    }
    case "atAGlance": {
      const headline = getString(parsed.headline);
      const bullets = getStringArray(parsed.bullets);
      return headline && bullets && bullets.length > 0
        ? { ok: true, value: { headline, bullets } as InsightsSectionValueMap[K] }
        : { ok: false, error: "atAGlance is missing headline or bullets" };
    }
  }
}

function topKey(map: Record<string, number>): string {
  const [key = "unknown"] = Object.entries(map).sort((a, b) => b[1] - a[1])[0] ?? [];
  return key;
}

export function buildDeterministicAtAGlance(
  stats: AggregatedStats,
): InsightsAtAGlanceSection {
  const topGoal = topKey(stats.goalCategories);
  const topProject = topKey(stats.projectBreakdown);
  const topArea = topKey(stats.projectAreaBreakdown);
  const topTool = topKey(stats.toolBreakdown);
  const successfulSessions =
    (stats.outcomeBreakdown.fully_achieved ?? 0) +
    (stats.outcomeBreakdown.mostly_achieved ?? 0);

  return {
    headline: `${stats.sourceCli} sessions show the strongest value in ${topArea.replace(/_/g, " ")} work.`,
    bullets: [
      `${stats.totalSessions} sessions produced ${stats.totalLinesAdded} added lines across ${stats.totalFilesModified} modified files, with ${successfulSessions} sessions landing in fully or mostly achieved outcomes.`,
      `The dominant work pattern is ${topGoal.replace(/_/g, " ")} inside ${topProject}, and ${topTool} is the tool most frequently involved in getting those sessions over the line.`,
      `Average assistant response time sits around ${stats.averageAssistantResponseSeconds}s, while the user usually follows up after ${stats.averageUserReplySeconds}s, which signals a hands-on but not chaotic review loop.`,
      `${stats.failedFacetSessions > 0 ? `${stats.failedFacetSessions} facet extractions failed, so some evidence is missing.` : "All analyzed sessions contributed facet evidence."} ${Object.keys(stats.toolErrorBreakdown).length > 0 ? `The main failure mode was ${topKey(stats.toolErrorBreakdown).replace(/_/g, " ")}.` : "Tool errors were limited."}`,
    ],
  };
}

export function aggregateFacets(
  facets: SessionFacet[],
  sessions: SessionInfo[],
  counts: InsightsPipelineCounts,
): AggregatedStats {
  const facetsById = new Map(facets.map((facet) => [facet.session_id, facet]));
  const analyzedSessions = sessions.filter((session) => facetsById.has(session.id));

  const assistantResponseSeconds = analyzedSessions.flatMap(
    (session) => session.metrics.assistantResponseSeconds,
  );
  const userReplySeconds = analyzedSessions.flatMap(
    (session) => session.metrics.userReplySeconds,
  );

  const stats: AggregatedStats = {
    ...counts,
    totalSessions: analyzedSessions.length,
    totalMessages: analyzedSessions.reduce((sum, session) => sum + session.messageCount, 0),
    totalDurationMinutes: analyzedSessions.reduce(
      (sum, session) => sum + session.durationMinutes,
      0,
    ),
    totalInputTokens: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.inputTokens,
      0,
    ),
    totalOutputTokens: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.outputTokens,
      0,
    ),
    totalCachedInputTokens: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.cachedInputTokens,
      0,
    ),
    totalReasoningTokens: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.reasoningTokens,
      0,
    ),
    totalGitCommits: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.gitCommits,
      0,
    ),
    totalGitPushes: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.gitPushes,
      0,
    ),
    totalFilesModified: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.filesModified,
      0,
    ),
    totalLinesAdded: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.linesAdded,
      0,
    ),
    totalLinesRemoved: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.linesRemoved,
      0,
    ),
    totalUserInterruptions: analyzedSessions.reduce(
      (sum, session) => sum + session.metrics.userInterruptions,
      0,
    ),
    averageAssistantResponseSeconds: averageRounded(assistantResponseSeconds),
    averageUserReplySeconds: averageRounded(userReplySeconds),
    cliBreakdown: {},
    outcomeBreakdown: {},
    sessionTypeBreakdown: {},
    goalCategories: {},
    frictionCounts: {},
    satisfactionBreakdown: {},
    projectBreakdown: {},
    projectAreaBreakdown: {},
    toolBreakdown: {},
    languageBreakdown: {},
    modelBreakdown: {},
    toolErrorBreakdown: {},
    messageHourBreakdown: {},
    responseTimeBreakdown: {},
    userReplyBreakdown: {},
    featureUsageBreakdown: {},
  };

  for (const session of analyzedSessions) {
    for (const [tool, count] of Object.entries(session.metrics.toolCounts)) {
      incr(stats.toolBreakdown, tool, count);
    }
    for (const [language, count] of Object.entries(session.metrics.languages)) {
      incr(stats.languageBreakdown, language, count);
    }
    for (const [model, count] of Object.entries(session.metrics.modelCounts)) {
      incr(stats.modelBreakdown, model, count);
    }
    for (const [category, count] of Object.entries(session.metrics.toolErrorCategories)) {
      incr(stats.toolErrorBreakdown, category, count);
    }
    for (const [hour, count] of Object.entries(session.metrics.messageHours)) {
      incr(stats.messageHourBreakdown, hour, count);
    }
    for (const [feature, count] of Object.entries(session.metrics.featureUsage)) {
      incr(stats.featureUsageBreakdown, feature, count);
    }
    for (const seconds of session.metrics.assistantResponseSeconds) {
      incr(stats.responseTimeBreakdown, responseBucket(seconds));
    }
    for (const seconds of session.metrics.userReplySeconds) {
      incr(stats.userReplyBreakdown, userReplyBucket(seconds));
    }
  }

  for (const facet of facets) {
    incr(stats.cliBreakdown, facet.cli_tool);
    incr(stats.outcomeBreakdown, facet.outcome);
    incr(stats.sessionTypeBreakdown, facet.session_type);
    incr(stats.satisfactionBreakdown, facet.user_satisfaction);
    incr(
      stats.projectBreakdown,
      facet.project_path ? path.basename(facet.project_path) : "unknown",
    );
    incr(stats.projectAreaBreakdown, facet.project_area || "unknown");

    for (const [category, weight] of Object.entries(facet.goal_categories)) {
      incr(stats.goalCategories, category, weight);
    }
    for (const [type, count] of Object.entries(facet.friction_counts)) {
      incr(stats.frictionCounts, type, count);
    }
  }

  return stats;
}
