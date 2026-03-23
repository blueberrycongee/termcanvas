import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { buildCliInvocationArgs } from "./insights-cli";
import { generateReport } from "./insights-report";
import {
  aggregateFacets,
  buildDeterministicAtAGlance,
  buildSessionFingerprint,
  buildTranscriptWindow,
  createEmptySessionMetrics,
  InsightsCliTool,
  InsightsError,
  InsightsGenerateResult,
  InsightsProgress,
  InsightsResult,
  InsightsSectionKey,
  isSelfInsightSession,
  parseStructuredSection,
  SessionFacet,
  SessionInfo,
} from "./insights-shared";
import { PtyResolvedLaunchSpec, buildLaunchSpec } from "./pty-launch";
import { TERMCANVAS_DIR } from "./state-persistence";
import { findClaudeJsonlFiles, findCodexJsonlFiles } from "./usage-collector";

interface SessionFileInfo {
  id: string;
  filePath: string;
  cliTool: InsightsCliTool;
  mtimeMs: number;
  fileSize: number;
}

interface CachedSessionMetaEntry {
  version: number;
  sourceFingerprint: string;
  session: SessionInfo;
}

interface CachedFacetEntry {
  version: number;
  analyzerCli: InsightsCliTool;
  sourceFingerprint: string;
  facet: SessionFacet;
}

interface ScanResult {
  sessions: SessionInfo[];
  totalScannedSessions: number;
}

interface FacetSelectionResult {
  eligibleSessions: SessionInfo[];
  facetEligibleSessions: SessionInfo[];
  metricsOnlySessions: number;
}

const CACHE_VERSION = 3;
const SESSION_META_CACHE_DIR = path.join(
  TERMCANVAS_DIR,
  "insights-cache",
  "session-meta",
);
const FACET_CACHE_DIR = path.join(TERMCANVAS_DIR, "insights-cache", "facets");
const SESSION_META_CACHE_BATCH = 50;
const ANALYSIS_SAMPLE_LIMIT = 36;
const LANGUAGE_SAMPLE_MIN = 5;
const LANGUAGE_SAMPLE_MAX = 10;
const RECENT_SAMPLE_SESSION_LIMIT = 24;
const MS_PER_DAY = 86_400_000;
const LANGUAGE_DETECTION_INSTRUCTION =
  "Detect the primary language of the sampled user messages below. Generate ALL text output in that same language. If the user writes in Chinese, your entire output MUST be in Chinese. If English, output English.";

const PATH_LANGUAGE_MAP: Record<string, string> = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".go": "go",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  ".kt": "kotlin",
  ".md": "markdown",
  ".mjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "shell",
  ".sql": "sql",
  ".swift": "swift",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".txt": "text",
  ".yaml": "yaml",
  ".yml": "yaml",
};

function cacheFileName(prefix: string, key: string): string {
  const digest = crypto.createHash("sha1").update(key).digest("hex");
  return `${prefix}-${digest}.json`;
}

function metaCachePath(file: SessionFileInfo): string {
  return path.join(
    SESSION_META_CACHE_DIR,
    cacheFileName("meta", `${file.cliTool}:${file.id}`),
  );
}

function facetCachePath(
  session: SessionInfo,
  analyzerCli: InsightsCliTool,
): string {
  return path.join(
    FACET_CACHE_DIR,
    cacheFileName("facet", `${session.cliTool}:${analyzerCli}:${session.id}`),
  );
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function extractTextFromContent(content: unknown): string {
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

function truncateText(text: string, maxChars = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function recordHour(metrics: SessionInfo["metrics"], timestampMs: number): void {
  const hour = String(new Date(timestampMs).getHours()).padStart(2, "0");
  metrics.messageHours[hour] = (metrics.messageHours[hour] ?? 0) + 1;
}

function trackModel(metrics: SessionInfo["metrics"], model: unknown): void {
  if (typeof model !== "string" || !model) return;
  metrics.modelCounts[model] = (metrics.modelCounts[model] ?? 0) + 1;
}

function trackLanguageFromPath(
  metrics: SessionInfo["metrics"],
  filePath: unknown,
): void {
  if (typeof filePath !== "string" || !filePath) return;
  const ext = path.extname(filePath).toLowerCase();
  const language = PATH_LANGUAGE_MAP[ext];
  if (!language) return;
  metrics.languages[language] = (metrics.languages[language] ?? 0) + 1;
}

function trackPathsFromText(metrics: SessionInfo["metrics"], text: string): void {
  const matches = text.match(/[\w./~-]+\.[a-z0-9]+/gi) ?? [];
  for (const match of matches) {
    trackLanguageFromPath(metrics, match);
  }
}

function trackPatchStats(metrics: SessionInfo["metrics"], patchText: string): void {
  const fileMatches =
    patchText.match(/^\*\*\* (?:Add|Update|Delete) File:/gm) ??
    patchText.match(/^diff --git /gm) ??
    [];
  metrics.filesModified += fileMatches.length;

  for (const line of patchText.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("*** ")) {
      continue;
    }
    if (line.startsWith("+")) metrics.linesAdded += 1;
    if (line.startsWith("-")) metrics.linesRemoved += 1;
  }
}

function trackEditInput(
  metrics: SessionInfo["metrics"],
  input: Record<string, unknown>,
): void {
  trackLanguageFromPath(metrics, input.file_path);
  metrics.filesModified += 1;
  const oldString = typeof input.old_string === "string" ? input.old_string : "";
  const newString = typeof input.new_string === "string" ? input.new_string : "";
  const oldLines = oldString ? oldString.split("\n").length : 0;
  const newLines = newString ? newString.split("\n").length : 0;
  if (newLines > oldLines) metrics.linesAdded += newLines - oldLines;
  if (oldLines > newLines) metrics.linesRemoved += oldLines - newLines;
}

function trackWriteInput(
  metrics: SessionInfo["metrics"],
  input: Record<string, unknown>,
): void {
  trackLanguageFromPath(metrics, input.file_path);
  metrics.filesModified += 1;
  if (typeof input.content === "string" && input.content.length > 0) {
    metrics.linesAdded += input.content.split("\n").length;
  }
}

function trackCommandMetrics(
  metrics: SessionInfo["metrics"],
  command: string,
): void {
  const normalized = command.toLowerCase();
  if (/\bgit\s+commit\b/.test(normalized)) metrics.gitCommits += 1;
  if (/\bgit\s+push\b/.test(normalized)) metrics.gitPushes += 1;
  trackPathsFromText(metrics, command);
}

function categorizeError(text: string): string {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("auth") ||
    normalized.includes("api key")
  ) {
    return "auth";
  }
  if (
    normalized.includes("permission") ||
    normalized.includes("denied") ||
    normalized.includes("forbidden")
  ) {
    return "permission";
  }
  if (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("enotfound") ||
    normalized.includes("network") ||
    normalized.includes("econn")
  ) {
    return "network";
  }
  if (
    normalized.includes("not found") ||
    normalized.includes("enoent") ||
    normalized.includes("missing")
  ) {
    return "missing_file";
  }
  if (
    normalized.includes("exit code") ||
    normalized.includes("command not found") ||
    normalized.includes("process exited with code")
  ) {
    return "shell";
  }
  return "other";
}

function addTranscriptLine(parts: string[], prefix: string, text: string): void {
  const line = truncateText(text, 360);
  if (!line) return;
  parts.push(`${prefix}: ${line}`);
}

function getAdaptiveBatchSize(total: number): number {
  if (total <= 100) return 10;
  if (total <= 500) return 15;
  return 20;
}

function buildSessionFileInfo(
  cliTool: InsightsCliTool,
  filePath: string,
): SessionFileInfo | null {
  try {
    const stat = fs.statSync(filePath);
    const rawId = path.basename(filePath, ".jsonl");
    return {
      id: `${cliTool}:${rawId}`,
      filePath,
      cliTool,
      mtimeMs: stat.mtimeMs,
      fileSize: stat.size,
    };
  } catch {
    return null;
  }
}

function discoverSessionFiles(): SessionFileInfo[] {
  const files = [
    ...findClaudeJsonlFiles().map((filePath) => ({ cliTool: "claude" as const, filePath })),
    ...findCodexJsonlFiles().map((filePath) => ({ cliTool: "codex" as const, filePath })),
  ];
  const indexed: SessionFileInfo[] = [];

  for (const file of files) {
    const info = buildSessionFileInfo(file.cliTool, file.filePath);
    if (info) indexed.push(info);
  }

  indexed.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const deduped = new Map<string, SessionFileInfo>();
  for (const file of indexed) {
    const existing = deduped.get(file.id);
    if (!existing || file.mtimeMs > existing.mtimeMs) {
      deduped.set(file.id, file);
    }
  }
  return [...deduped.values()];
}

function extractClaudeSession(file: SessionFileInfo): SessionInfo | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file.filePath, "utf-8");
  } catch {
    return null;
  }

  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  let projectPath = "";
  const rel = path.relative(projectsDir, file.filePath);
  const topDir = rel.split(path.sep)[0];
  if (topDir && topDir.startsWith("-")) {
    const cleaned = topDir.replace(/(--worktrees-|-.worktrees-).*$/, "");
    projectPath = cleaned.replace(/-/g, "/");
  }

  const metrics = createEmptySessionMetrics();
  const toolNamesById = new Map<string, string>();
  const transcriptParts: string[] = [];
  const userMessageSnippets: string[] = [];
  const timestamps: number[] = [];
  let messageCount = 0;
  let lastUserTs: number | null = null;
  let lastAssistantTs: number | null = null;
  let lastRole: "user" | "assistant" | null = null;

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (!projectPath && typeof obj.cwd === "string") {
      projectPath = obj.cwd;
    }

    const ts = parseTimestamp(obj.timestamp);
    if (ts !== null) timestamps.push(ts);

    if (obj.type !== "user" && obj.type !== "assistant") continue;
    const msg = getObject(obj.message);
    if (!msg) continue;
    const role = msg.role;
    if (role !== "user" && role !== "assistant") continue;

    messageCount += 1;
    if (ts !== null) recordHour(metrics, ts);

    if (role === "user") {
      const text = extractTextFromContent(msg.content);
      if (text) {
        addTranscriptLine(transcriptParts, "user", text);
        if (userMessageSnippets.length < 12) {
          userMessageSnippets.push(truncateText(text, 220));
        }
        if (lastAssistantTs !== null && ts !== null) {
          metrics.userReplySeconds.push(Math.max(0, Math.round((ts - lastAssistantTs) / 1000)));
        }
        if (lastRole === "user") {
          metrics.userInterruptions += 1;
        }
      }

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!block || typeof block !== "object") continue;
          const entry = block as Record<string, unknown>;
          if (entry.type !== "tool_result") continue;
          const toolName =
            typeof entry.tool_use_id === "string"
              ? toolNamesById.get(entry.tool_use_id) ?? "tool"
              : "tool";
          const contentText =
            typeof entry.content === "string"
              ? entry.content
              : extractTextFromContent(entry.content);
          const toolUseResult = getObject(obj.toolUseResult);
          const statusCode =
            typeof toolUseResult?.code === "number" ? toolUseResult.code : null;
          const isError =
            entry.is_error === true ||
            (statusCode !== null && statusCode >= 400) ||
            /\b(error|failed|exception)\b/i.test(contentText);
          if (isError) {
            const category = categorizeError(contentText);
            metrics.toolErrorCategories[category] =
              (metrics.toolErrorCategories[category] ?? 0) + 1;
          }
          if (contentText) {
            addTranscriptLine(transcriptParts, `${toolName} result`, contentText);
          }
        }
      }

      if (ts !== null) lastUserTs = ts;
      lastRole = "user";
      continue;
    }

    if (ts !== null && lastUserTs !== null && lastRole === "user") {
      metrics.assistantResponseSeconds.push(
        Math.max(0, Math.round((ts - lastUserTs) / 1000)),
      );
    }

    trackModel(metrics, msg.model);
    const usage = getObject(msg.usage);
    metrics.inputTokens += typeof usage?.input_tokens === "number" ? usage.input_tokens : 0;
    metrics.outputTokens +=
      typeof usage?.output_tokens === "number" ? usage.output_tokens : 0;
    metrics.cachedInputTokens +=
      typeof usage?.cache_read_input_tokens === "number"
        ? usage.cache_read_input_tokens
        : 0;

    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== "object") continue;
        const entry = block as Record<string, unknown>;
        if (entry.type === "tool_use") {
          const toolName =
            typeof entry.name === "string" && entry.name ? entry.name : "tool";
          const input = getObject(entry.input) ?? {};
          if (typeof entry.id === "string") toolNamesById.set(entry.id, toolName);
          metrics.toolCounts[toolName] = (metrics.toolCounts[toolName] ?? 0) + 1;

          if (toolName === "WebSearch") metrics.featureUsage.web_search = 1;
          if (toolName === "WebFetch") metrics.featureUsage.web_fetch = 1;
          if (toolName === "Task") metrics.featureUsage.task_agent = 1;
          if (toolName.startsWith("mcp__")) metrics.featureUsage.mcp = 1;

          if (toolName === "Bash" && typeof input.command === "string") {
            metrics.featureUsage.shell = 1;
            trackCommandMetrics(metrics, input.command);
            addTranscriptLine(transcriptParts, "assistant tool", `${toolName} ${input.command}`);
          } else if (toolName === "Edit") {
            trackEditInput(metrics, input);
            addTranscriptLine(
              transcriptParts,
              "assistant tool",
              `${toolName} ${String(input.file_path ?? "")}`,
            );
          } else if (toolName === "MultiEdit") {
            trackLanguageFromPath(metrics, input.file_path);
            const edits = Array.isArray(input.edits) ? input.edits : [];
            metrics.filesModified += edits.length > 0 ? 1 : 0;
            for (const edit of edits) {
              if (!edit || typeof edit !== "object") continue;
              trackEditInput(metrics, {
                file_path: input.file_path,
                ...(edit as Record<string, unknown>),
              });
            }
            addTranscriptLine(
              transcriptParts,
              "assistant tool",
              `${toolName} ${String(input.file_path ?? "")}`,
            );
          } else if (toolName === "Write") {
            trackWriteInput(metrics, input);
            addTranscriptLine(
              transcriptParts,
              "assistant tool",
              `${toolName} ${String(input.file_path ?? "")}`,
            );
          } else {
            trackLanguageFromPath(metrics, input.file_path);
            trackLanguageFromPath(metrics, input.path);
            const summary =
              typeof input.query === "string"
                ? `${toolName} ${input.query}`
                : typeof input.url === "string"
                  ? `${toolName} ${input.url}`
                  : `${toolName} ${String(input.file_path ?? input.path ?? "")}`;
            addTranscriptLine(transcriptParts, "assistant tool", summary);
          }
          continue;
        }

        const text =
          typeof entry.text === "string"
            ? entry.text
            : typeof entry.thinking === "string"
              ? entry.thinking
              : "";
        if (text) addTranscriptLine(transcriptParts, "assistant", text);
      }
    } else {
      const text = extractTextFromContent(msg.content);
      if (text) addTranscriptLine(transcriptParts, "assistant", text);
    }

    if (ts !== null) lastAssistantTs = ts;
    lastRole = "assistant";
  }

  if (messageCount < 2) return null;
  const startTimeMs = timestamps.length > 0 ? Math.min(...timestamps) : file.mtimeMs;
  const endTimeMs = timestamps.length > 0 ? Math.max(...timestamps) : file.mtimeMs;
  const durationMinutes = Math.round(Math.max(0, endTimeMs - startTimeMs) / 60_000);
  if (durationMinutes < 1) return null;

  const contentSummary = buildTranscriptWindow(transcriptParts, 4_000);
  const analysisText = buildTranscriptWindow(transcriptParts, 12_000);
  if (isSelfInsightSession(contentSummary) || isSelfInsightSession(raw.slice(0, 8_000))) {
    return null;
  }

  return {
    id: file.id,
    filePath: file.filePath,
    cliTool: "claude",
    projectPath,
    startTimeMs,
    endTimeMs,
    messageCount,
    durationMinutes,
    contentSummary,
    analysisText,
    mtimeMs: file.mtimeMs,
    fileSize: file.fileSize,
    metrics,
    userMessageSnippets,
  };
}

function parseFunctionCallArguments(
  value: unknown,
): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractCodexSession(file: SessionFileInfo): SessionInfo | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file.filePath, "utf-8");
  } catch {
    return null;
  }

  let projectPath = "";
  const metrics = createEmptySessionMetrics();
  const transcriptParts: string[] = [];
  const userMessageSnippets: string[] = [];
  const timestamps: number[] = [];
  let sessionStartTs: number | null = null;
  let messageCount = 0;
  let lastUserTs: number | null = null;
  let lastAssistantTs: number | null = null;
  let lastRole: "user" | "assistant" | null = null;
  let latestUsage:
    | {
        input: number;
        output: number;
        cached: number;
        reasoning: number;
      }
    | null = null;

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const ts = parseTimestamp(obj.timestamp);
    if (ts !== null) timestamps.push(ts);

    if (obj.type === "session_meta") {
      const payload = getObject(obj.payload);
      if (typeof payload?.cwd === "string") projectPath = payload.cwd;
      if (
        payload?.originator === "codex_exec" &&
        payload?.source === "exec"
      ) {
        return null;
      }
      const metaTs = parseTimestamp(payload?.timestamp);
      if (metaTs !== null) sessionStartTs = metaTs;
      if (typeof payload?.model_provider === "string") {
        metrics.modelCounts[payload.model_provider] =
          (metrics.modelCounts[payload.model_provider] ?? 0) + 1;
      }
      continue;
    }

    if (obj.type === "event_msg") {
      const payload = getObject(obj.payload);
      if (!payload) continue;

      if (payload.type === "user_message" && typeof payload.message === "string") {
        messageCount += 1;
        if (ts !== null) recordHour(metrics, ts);
        addTranscriptLine(transcriptParts, "user", payload.message);
        if (userMessageSnippets.length < 12) {
          userMessageSnippets.push(truncateText(payload.message, 220));
        }
        if (lastAssistantTs !== null && ts !== null) {
          metrics.userReplySeconds.push(Math.max(0, Math.round((ts - lastAssistantTs) / 1000)));
        }
        if (lastRole === "user") metrics.userInterruptions += 1;
        if (ts !== null) lastUserTs = ts;
        lastRole = "user";
        continue;
      }

      if (payload.type === "agent_message" && typeof payload.message === "string") {
        messageCount += 1;
        if (ts !== null) recordHour(metrics, ts);
        addTranscriptLine(transcriptParts, "assistant", payload.message);
        if (ts !== null && lastUserTs !== null && lastRole === "user") {
          metrics.assistantResponseSeconds.push(
            Math.max(0, Math.round((ts - lastUserTs) / 1000)),
          );
        }
        if (ts !== null) lastAssistantTs = ts;
        lastRole = "assistant";
        continue;
      }

      if (payload.type === "token_count") {
        const info = getObject(payload.info);
        const totalUsage = getObject(info?.total_token_usage);
        if (totalUsage) {
          latestUsage = {
            input:
              typeof totalUsage.input_tokens === "number"
                ? totalUsage.input_tokens
                : 0,
            output:
              typeof totalUsage.output_tokens === "number"
                ? totalUsage.output_tokens
                : 0,
            cached:
              typeof totalUsage.cached_input_tokens === "number"
                ? totalUsage.cached_input_tokens
                : 0,
            reasoning:
              typeof totalUsage.reasoning_output_tokens === "number"
                ? totalUsage.reasoning_output_tokens
                : 0,
          };
        }
      }
      continue;
    }

    if (obj.type !== "response_item") continue;
    const payload = getObject(obj.payload);
    if (!payload) continue;

    if (payload.type === "function_call") {
      const name = typeof payload.name === "string" ? payload.name : "tool";
      metrics.toolCounts[name] = (metrics.toolCounts[name] ?? 0) + 1;
      const args = parseFunctionCallArguments(payload.arguments) ?? {};
      const command = typeof args.cmd === "string" ? args.cmd : "";

      if (name === "exec_command") {
        metrics.featureUsage.shell = 1;
        if (command) {
          trackCommandMetrics(metrics, command);
          addTranscriptLine(transcriptParts, "assistant tool", `${name} ${command}`);
        }
      } else if (name === "write_stdin") {
        metrics.featureUsage.pty = 1;
      } else if (name === "update_plan") {
        metrics.featureUsage.plan_updates = 1;
      } else if (name === "spawn_agent") {
        metrics.featureUsage.task_agent = 1;
      } else if (name.startsWith("mcp__")) {
        metrics.featureUsage.mcp = 1;
      }

      if (name.includes("apply_patch")) {
        metrics.featureUsage.apply_patch = 1;
      }
      if (name.includes("browser_")) {
        metrics.featureUsage.browser = 1;
      }
      trackPathsFromText(metrics, command);
      continue;
    }

    if (payload.type === "custom_tool_call") {
      const name = typeof payload.name === "string" ? payload.name : "tool";
      metrics.toolCounts[name] = (metrics.toolCounts[name] ?? 0) + 1;
      if (name === "apply_patch" && typeof payload.input === "string") {
        metrics.featureUsage.apply_patch = 1;
        trackPatchStats(metrics, payload.input);
        addTranscriptLine(transcriptParts, "assistant tool", `${name} patch update`);
      }
      continue;
    }

    if (payload.type === "function_call_output" && typeof payload.output === "string") {
      if (
        payload.output.includes("Process exited with code") &&
        !payload.output.includes("Process exited with code 0")
      ) {
        const category = categorizeError(payload.output);
        metrics.toolErrorCategories[category] =
          (metrics.toolErrorCategories[category] ?? 0) + 1;
      }
      continue;
    }

    if (payload.type === "message" && payload.role === "user") {
      const text = extractTextFromContent(payload.content);
      if (text) {
        messageCount += 1;
        if (ts !== null) recordHour(metrics, ts);
        addTranscriptLine(transcriptParts, "user", text);
        if (userMessageSnippets.length < 12) {
          userMessageSnippets.push(truncateText(text, 220));
        }
      }
      continue;
    }

    if (payload.type === "message" && payload.role === "assistant") {
      const text = extractTextFromContent(payload.content);
      if (text) {
        messageCount += 1;
        if (ts !== null) recordHour(metrics, ts);
        addTranscriptLine(transcriptParts, "assistant", text);
      }
    }
  }

  if (latestUsage) {
    metrics.inputTokens = latestUsage.input;
    metrics.outputTokens = latestUsage.output;
    metrics.cachedInputTokens = latestUsage.cached;
    metrics.reasoningTokens = latestUsage.reasoning;
  }

  if (messageCount < 2) return null;
  const startTimeMs =
    sessionStartTs ??
    (timestamps.length > 0 ? Math.min(...timestamps) : file.mtimeMs);
  const endTimeMs = timestamps.length > 0 ? Math.max(...timestamps) : file.mtimeMs;
  const durationMinutes = Math.round(Math.max(0, endTimeMs - startTimeMs) / 60_000);
  if (durationMinutes < 1) return null;

  const contentSummary = buildTranscriptWindow(transcriptParts, 4_000);
  const analysisText = buildTranscriptWindow(transcriptParts, 12_000);
  if (isSelfInsightSession(contentSummary) || isSelfInsightSession(raw.slice(0, 8_000))) {
    return null;
  }

  return {
    id: file.id,
    filePath: file.filePath,
    cliTool: "codex",
    projectPath,
    startTimeMs,
    endTimeMs,
    messageCount,
    durationMinutes,
    contentSummary,
    analysisText,
    mtimeMs: file.mtimeMs,
    fileSize: file.fileSize,
    metrics,
    userMessageSnippets,
  };
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractSession(file: SessionFileInfo): SessionInfo | null {
  return file.cliTool === "claude"
    ? extractClaudeSession(file)
    : extractCodexSession(file);
}

function readCachedSessionMeta(file: SessionFileInfo): SessionInfo | null {
  try {
    const raw = fs.readFileSync(metaCachePath(file), "utf-8");
    const parsed = JSON.parse(raw) as CachedSessionMetaEntry;
    if (
      parsed.version !== CACHE_VERSION ||
      parsed.sourceFingerprint !==
        buildSessionFingerprint({
          cliTool: file.cliTool,
          filePath: file.filePath,
          mtimeMs: file.mtimeMs,
          fileSize: file.fileSize,
        })
    ) {
      return null;
    }
    return parsed.session;
  } catch {
    return null;
  }
}

function writeCachedSessionMeta(session: SessionInfo): void {
  try {
    fs.mkdirSync(SESSION_META_CACHE_DIR, { recursive: true });
    const entry: CachedSessionMetaEntry = {
      version: CACHE_VERSION,
      sourceFingerprint: buildSessionFingerprint(session),
      session,
    };
    fs.writeFileSync(
      metaCachePath(session),
      JSON.stringify(entry, null, 2),
      "utf-8",
    );
  } catch {
    // Cache writes are opportunistic.
  }
}

function readCachedFacet(
  session: SessionInfo,
  analyzerCli: InsightsCliTool,
): SessionFacet | null {
  try {
    const raw = fs.readFileSync(facetCachePath(session, analyzerCli), "utf-8");
    const parsed = JSON.parse(raw) as CachedFacetEntry;
    if (
      parsed.version !== CACHE_VERSION ||
      parsed.analyzerCli !== analyzerCli ||
      parsed.sourceFingerprint !== buildSessionFingerprint(session)
    ) {
      return null;
    }
    return parsed.facet;
  } catch {
    return null;
  }
}

function writeCachedFacet(
  session: SessionInfo,
  analyzerCli: InsightsCliTool,
  facet: SessionFacet,
): void {
  try {
    fs.mkdirSync(FACET_CACHE_DIR, { recursive: true });
    const entry: CachedFacetEntry = {
      version: CACHE_VERSION,
      analyzerCli,
      sourceFingerprint: buildSessionFingerprint(session),
      facet,
    };
    fs.writeFileSync(
      facetCachePath(session, analyzerCli),
      JSON.stringify(entry, null, 2),
      "utf-8",
    );
  } catch {
    // Cache writes are opportunistic.
  }
}

async function scanSessions(
  onProgress: (p: Omit<InsightsProgress, "jobId">) => void,
): Promise<ScanResult> {
  const files = discoverSessionFiles();
  const cachedSessions: SessionInfo[] = [];
  const uncachedFiles: SessionFileInfo[] = [];
  const loadBatchSize = getAdaptiveBatchSize(files.length);

  for (let i = 0; i < files.length; i += SESSION_META_CACHE_BATCH) {
    const batch = files.slice(i, i + SESSION_META_CACHE_BATCH);
    for (const file of batch) {
      const cached = readCachedSessionMeta(file);
      if (cached) {
        cachedSessions.push(cached);
      } else {
        uncachedFiles.push(file);
      }
    }
    onProgress({
      stage: "scanning",
      current: Math.min(i + batch.length, files.length),
      total: files.length,
      message: "Scanning Claude and Codex sessions...",
    });
    if (i + batch.length < files.length) await yieldToEventLoop();
  }

  const loadedSessions: SessionInfo[] = [];
  for (let i = 0; i < uncachedFiles.length; i += loadBatchSize) {
    const batch = uncachedFiles.slice(i, i + loadBatchSize);
    for (const file of batch) {
      const session = extractSession(file);
      if (!session) continue;
      loadedSessions.push(session);
      writeCachedSessionMeta(session);
    }
    onProgress({
      stage: "scanning",
      current: files.length,
      total: files.length,
      message: `Loaded ${Math.min(i + batch.length, uncachedFiles.length)} new sessions`,
    });
    if (i + batch.length < uncachedFiles.length) await yieldToEventLoop();
  }

  const deduped = new Map<string, SessionInfo>();
  for (const session of [...cachedSessions, ...loadedSessions]) {
    const existing = deduped.get(session.id);
    if (
      !existing ||
      session.messageCount > existing.messageCount ||
      session.durationMinutes > existing.durationMinutes ||
      session.mtimeMs > existing.mtimeMs
    ) {
      deduped.set(session.id, session);
    }
  }

  const sessions = [...deduped.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { sessions, totalScannedSessions: files.length };
}

async function resolveCliSpec(
  cliTool: InsightsCliTool,
): Promise<PtyResolvedLaunchSpec> {
  return buildLaunchSpec({ cwd: process.cwd(), shell: cliTool });
}

async function invokeCli(
  spec: PtyResolvedLaunchSpec,
  cliTool: InsightsCliTool,
  prompt: string,
  timeoutMs = 120_000,
): Promise<string> {
  const invocation = buildCliInvocationArgs(spec.args, cliTool, prompt);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(spec.file, invocation.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new Error(`CLI timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0 && code !== null) {
        reject(new Error(`CLI exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (invocation.stdin !== null) {
      child.stdin.write(invocation.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

export async function validateCli(
  cliTool: InsightsCliTool,
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
    const timeout = cliTool === "codex" ? 60_000 : 15_000;
    const response = await invokeCli(
      spec,
      cliTool,
      "Reply with exactly: OK",
      timeout,
    );
    if (!response.includes("OK")) {
      return {
        code: "auth_failed",
        message: `${cliTool} CLI responded but did not return expected output`,
        detail: response.slice(0, 500),
      };
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("auth") ||
      message.includes("401") ||
      message.includes("API key")
    ) {
      return {
        code: "auth_failed",
        message: `${cliTool} authentication failed`,
        detail: message,
      };
    }
    return {
      code: "cli_error",
      message: `${cliTool} CLI invocation failed`,
      detail: message,
    };
  }
}

function parseJsonFromResponse(response: string): Record<string, unknown> | null {
  const cleaned = response.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}

function normalizeNumericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(numeric)) continue;
    result[key] = numeric;
  }
  return result;
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
  "project_area",
  "recommended_next_step",
] as const;

function calculateSessionAgeDays(
  session: SessionInfo,
  nowMs = Date.now(),
): number {
  return Math.max(0, (nowMs - session.endTimeMs) / MS_PER_DAY);
}

function calculateImportanceScore(session: SessionInfo): number {
  return (
    session.messageCount * 2 +
    session.durationMinutes +
    session.metrics.linesAdded / 10 +
    session.metrics.gitCommits * 20
  );
}

function selectTopFraction(
  sessions: SessionInfo[],
  fraction: number,
): SessionInfo[] {
  if (sessions.length === 0) return [];
  const count = Math.max(1, Math.ceil(sessions.length * fraction));
  return [...sessions]
    .sort((a, b) => calculateImportanceScore(b) - calculateImportanceScore(a))
    .slice(0, count);
}

function sampleSnippets(
  snippets: string[],
  seed: string,
  maxSamples = LANGUAGE_SAMPLE_MAX,
): string[] {
  if (snippets.length === 0) return [];
  const targetCount = Math.min(
    maxSamples,
    Math.max(LANGUAGE_SAMPLE_MIN, Math.min(snippets.length, maxSamples)),
  );
  return [...snippets]
    .map((snippet, index) => ({
      snippet,
      order: crypto
        .createHash("sha1")
        .update(`${seed}:${index}:${snippet}`)
        .digest("hex"),
    }))
    .sort((a, b) => a.order.localeCompare(b.order))
    .slice(0, targetCount)
    .map(({ snippet }) => snippet);
}

function sampleRecentUserMessages(sessions: SessionInfo[]): string[] {
  const recentPool = sessions
    .slice(0, RECENT_SAMPLE_SESSION_LIMIT)
    .flatMap((session) => session.userMessageSnippets ?? []);
  const seed = sessions.slice(0, 12).map((session) => session.id).join("|");
  return sampleSnippets(recentPool, seed || "recent-sessions");
}

function buildLanguageContext(snippets: string[]): string {
  if (snippets.length === 0) return LANGUAGE_DETECTION_INSTRUCTION;
  return [
    LANGUAGE_DETECTION_INSTRUCTION,
    "Sampled user messages:",
    ...snippets.map((snippet, index) => `${index + 1}. ${snippet}`),
  ].join("\n");
}

function buildFacetPrompt(session: SessionInfo): string {
  return [
    "Analyze this AI coding session and return a JSON object with exactly these fields:",
    `- session_id: "${session.id}"`,
    `- cli_tool: "${session.cliTool}"`,
    "- underlying_goal: one sentence describing the user's real goal",
    "- brief_summary: 2-3 sentence recap grounded in the session evidence",
    '- goal_categories: object with weights for categories like "bug_fix","feature","refactor","release","research","docs","ops"',
    '- outcome: one of "fully_achieved","mostly_achieved","partially_achieved","not_achieved","unclear"',
    '- session_type: one of "single_task","multi_task","iterative","exploratory","quick_question"',
    '- friction_counts: object with counts for friction types like "retry","spec_gap","tool_failure","context_loss","review_loop"',
    '- user_satisfaction: one of "high","medium","low","unclear"',
    `- project_path: "${session.projectPath}"`,
    '- project_area: short label like "product_surface","release_ops","editor_infra","docs_workflow","research"',
    "- notable_tools: array of the most important tool names used in the session",
    "- dominant_languages: array of dominant languages or file types",
    "- wins: array of concise wins",
    "- frictions: array of concise friction observations",
    "- recommended_next_step: one practical next step for future runs",
    "",
    "CRITICAL RULES:",
    "- Use the metrics as primary evidence and the transcript excerpt as context.",
    "- Do not invent tools, files, or outcomes that are not present.",
    "- Keep project_area to a single snake_case label.",
    '- Infer user_satisfaction with this rubric: "high" when the goal is fully or mostly achieved with limited friction, or the user clearly signals satisfaction; "medium" when progress is useful but notable friction or mixed results remain; "low" when the goal is not achieved, failures repeat, or the user signals frustration; "unclear" ONLY when the transcript and metrics truly provide no signal.',
    "- Return ONLY valid JSON. No markdown fences. No prose.",
    "",
    buildLanguageContext(
      sampleSnippets(
        session.userMessageSnippets ?? [],
        session.id,
        LANGUAGE_SAMPLE_MAX,
      ),
    ),
    "",
    "Session metrics:",
    JSON.stringify(
      {
        durationMinutes: session.durationMinutes,
        messageCount: session.messageCount,
        startTimeMs: session.startTimeMs,
        endTimeMs: session.endTimeMs,
        metrics: session.metrics,
      },
      null,
      2,
    ),
    "",
    "Transcript excerpt:",
    session.analysisText,
  ].join("\n");
}

function pickDiverseFacets(facets: SessionFacet[]): SessionFacet[] {
  const selected: SessionFacet[] = [];
  const usedPairs = new Set<string>();
  for (const facet of facets) {
    const pair = `${facet.cli_tool}:${facet.project_area}:${facet.session_type}`;
    if (usedPairs.has(pair)) continue;
    usedPairs.add(pair);
    selected.push(facet);
    if (selected.length >= ANALYSIS_SAMPLE_LIMIT) return selected;
  }
  return facets.slice(0, ANALYSIS_SAMPLE_LIMIT);
}

function pickTopPerformingFacets(facets: SessionFacet[]): SessionFacet[] {
  return [...facets]
    .filter(
      (facet) =>
        (facet.outcome === "fully_achieved" ||
          facet.outcome === "mostly_achieved") &&
        facet.user_satisfaction !== "low",
    )
    .sort((a, b) => {
      const aScore = a.wins.length * 4 - a.frictions.length * 2;
      const bScore = b.wins.length * 4 - b.frictions.length * 2;
      return bScore - aScore;
    })
    .slice(0, ANALYSIS_SAMPLE_LIMIT);
}

function pickSuggestionFacets(facets: SessionFacet[]): SessionFacet[] {
  const successFacets = facets.filter(
    (facet) =>
      facet.outcome === "fully_achieved" || facet.outcome === "mostly_achieved",
  );
  const frictionFacets = facets.filter(
    (facet) =>
      facet.frictions.length > 0 || Object.keys(facet.friction_counts).length > 0,
  );
  const mixed = [...successFacets.slice(0, 10), ...frictionFacets.slice(0, 10)];
  const deduped = new Map<string, SessionFacet>();
  for (const facet of mixed) {
    deduped.set(facet.session_id, facet);
  }
  return [...deduped.values()].slice(0, ANALYSIS_SAMPLE_LIMIT);
}

function selectSessionsForFacetExtraction(
  sessions: SessionInfo[],
  nowMs = Date.now(),
): FacetSelectionResult {
  const eligibleSessions = sessions.filter(
    (session) => calculateSessionAgeDays(session, nowMs) < 90,
  );
  const fullTier = eligibleSessions.filter(
    (session) => calculateSessionAgeDays(session, nowMs) < 14,
  );
  const midTier = eligibleSessions.filter((session) => {
    const ageDays = calculateSessionAgeDays(session, nowMs);
    return ageDays >= 14 && ageDays < 30;
  });
  const olderTier = eligibleSessions.filter((session) => {
    const ageDays = calculateSessionAgeDays(session, nowMs);
    return ageDays >= 30 && ageDays < 60;
  });

  const facetEligibleSessions = [
    ...fullTier,
    ...selectTopFraction(midTier, 0.5),
    ...selectTopFraction(olderTier, 0.25),
  ].sort((a, b) => b.mtimeMs - a.mtimeMs);

  const facetIds = new Set(facetEligibleSessions.map((session) => session.id));
  const metricsOnlySessions = eligibleSessions.filter(
    (session) => !facetIds.has(session.id),
  ).length;

  return {
    eligibleSessions,
    facetEligibleSessions,
    metricsOnlySessions,
  };
}

function buildAnalysisDataContext(
  key: Exclude<InsightsSectionKey, "atAGlance">,
  stats: InsightsResult["stats"],
  facets: SessionFacet[],
): string {
  switch (key) {
    case "projectAreas":
      return JSON.stringify(
        {
          stats: {
            totalSessions: stats.totalSessions,
            projectBreakdown: stats.projectBreakdown,
            projectAreaBreakdown: stats.projectAreaBreakdown,
            goalCategories: stats.goalCategories,
            cliBreakdown: stats.cliBreakdown,
          },
          sampleFacets: facets.filter((facet) => facet.project_area),
        },
        null,
        2,
      );
    case "interactionStyle":
      return JSON.stringify(
        {
          stats: {
            totalSessions: stats.totalSessions,
            averageAssistantResponseSeconds: stats.averageAssistantResponseSeconds,
            averageUserReplySeconds: stats.averageUserReplySeconds,
            responseTimeBreakdown: stats.responseTimeBreakdown,
            userReplyBreakdown: stats.userReplyBreakdown,
            messageHourBreakdown: stats.messageHourBreakdown,
            cliBreakdown: stats.cliBreakdown,
          },
          sampleFacets: pickDiverseFacets(facets),
        },
        null,
        2,
      );
    case "whatWorks":
      return JSON.stringify(
        {
          stats: {
            totalSessions: stats.totalSessions,
            outcomeBreakdown: stats.outcomeBreakdown,
            satisfactionBreakdown: stats.satisfactionBreakdown,
            toolComparison: stats.toolComparison,
          },
          sampleFacets: facets.filter(
            (facet) =>
              facet.outcome === "fully_achieved" ||
              facet.outcome === "mostly_achieved",
          ),
        },
        null,
        2,
      );
    case "frictionAnalysis":
      return JSON.stringify(
        {
          stats: {
            totalSessions: stats.totalSessions,
            frictionCounts: stats.frictionCounts,
            toolErrorBreakdown: stats.toolErrorBreakdown,
            responseTimeBreakdown: stats.responseTimeBreakdown,
            userReplyBreakdown: stats.userReplyBreakdown,
          },
          sampleFacets: facets.filter(
            (facet) =>
              facet.frictions.length > 0 ||
              Object.keys(facet.friction_counts).length > 0,
          ),
        },
        null,
        2,
      );
    case "suggestions":
      return JSON.stringify(
        {
          stats,
          sampleFacets: pickSuggestionFacets(facets),
        },
        null,
        2,
      );
    case "onTheHorizon":
      return JSON.stringify(
        {
          stats,
          sampleFacets: pickTopPerformingFacets(facets),
        },
        null,
        2,
      );
    case "codingStory":
      return JSON.stringify(
        {
          stats: {
            totalSessions: stats.totalSessions,
            totalMessages: stats.totalMessages,
            totalLinesAdded: stats.totalLinesAdded,
            totalGitCommits: stats.totalGitCommits,
            dailyBreakdown: stats.dailyBreakdown,
            toolComparison: stats.toolComparison,
            achievements: stats.achievements,
          },
          sampleFacets: facets,
        },
        null,
        2,
      );
  }
}

export async function extractFacet(
  session: SessionInfo,
  cliSpec: PtyResolvedLaunchSpec,
  analyzerCli: InsightsCliTool,
): Promise<SessionFacet | InsightsError> {
  const cached = readCachedFacet(session, analyzerCli);
  if (cached) return cached;

  const prompt = buildFacetPrompt(session);

  let response: string;
  try {
    response = await invokeCli(cliSpec, analyzerCli, prompt);
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

  const facet: SessionFacet = {
    session_id: String(parsed.session_id),
    cli_tool: parsed.cli_tool === "claude" ? "claude" : "codex",
    underlying_goal: String(parsed.underlying_goal),
    brief_summary: String(parsed.brief_summary),
    goal_categories: normalizeNumericRecord(parsed.goal_categories),
    outcome: String(parsed.outcome) as SessionFacet["outcome"],
    session_type: String(parsed.session_type) as SessionFacet["session_type"],
    friction_counts: normalizeNumericRecord(parsed.friction_counts),
    user_satisfaction: String(parsed.user_satisfaction) as SessionFacet["user_satisfaction"],
    project_path: String(parsed.project_path),
    project_area: String(parsed.project_area),
    notable_tools: normalizeStringArray(parsed.notable_tools),
    dominant_languages: normalizeStringArray(parsed.dominant_languages),
    wins: normalizeStringArray(parsed.wins),
    frictions: normalizeStringArray(parsed.frictions),
    recommended_next_step: String(parsed.recommended_next_step),
  };

  writeCachedFacet(session, analyzerCli, facet);
  return facet;
}

function buildAnalysisPrompt(
  key: Exclude<InsightsSectionKey, "atAGlance">,
  dataCtx: string,
  sampledMessages: string[],
): string {
  const common = [
    "You are generating an executive-quality AI coding insights report.",
    "Use ONLY the provided data. Be specific. Ground claims in the metrics and sampled session facets.",
    "Keep strings concise and useful. No markdown. Return ONLY a valid JSON object.",
    "",
    buildLanguageContext(sampledMessages),
    "",
    "Data:",
    dataCtx,
    "",
  ].join("\n");

  switch (key) {
    case "projectAreas":
      return `${common}Return JSON with this exact shape:
{
  "summary": "short paragraph",
  "areas": [
    { "name": "string", "share": "string", "evidence": "string", "opportunities": "string" }
  ]
}
Rules:
- Provide 3 to 5 areas.
- share should describe relative weight, e.g. "Primary lane", "Secondary lane".
- opportunities should explain where deeper AI leverage is possible.`;
    case "interactionStyle":
      return `${common}Return JSON with this exact shape:
{
  "summary": "short paragraph",
  "patterns": [
    { "title": "string", "signal": "string", "impact": "string", "coaching": "string" }
  ]
}
Rules:
- Provide 3 to 5 patterns.
- Focus on how the user collaborates with the model, not generic advice.`;
    case "whatWorks":
      return `${common}Return JSON with this exact shape:
{
  "summary": "short paragraph",
  "wins": [
    { "title": "string", "evidence": "string", "whyItWorks": "string", "doMoreOf": "string" }
  ]
}
Rules:
- Provide 3 to 5 wins.
- Each win must tie back to a recurring success pattern.`;
    case "frictionAnalysis":
      return `${common}Return JSON with this exact shape:
{
  "summary": "short paragraph",
  "issues": [
    { "title": "string", "severity": "high|medium|low", "evidence": "string", "likelyCause": "string", "mitigation": "string" }
  ]
}
Rules:
- Provide 3 to 5 issues.
- severity must reflect real impact, not drama.`;
    case "suggestions":
      return `${common}Return JSON with this exact shape:
{
  "summary": "short paragraph",
  "actions": [
    { "title": "string", "priority": "now|next|later", "rationale": "string", "playbook": "string", "copyablePrompt": "string" }
  ]
}
Rules:
- Provide 4 to 6 actions.
- copyablePrompt should be ready to paste into Claude or Codex.
- Prefer operational suggestions over vague coaching.`;
    case "onTheHorizon":
      return `${common}Return JSON with this exact shape:
{
  "summary": "short paragraph",
  "bets": [
    { "title": "string", "whyNow": "string", "experiment": "string", "copyablePrompt": "string" }
  ]
}
Rules:
- Provide 2 to 4 forward-looking experiments.
- Experiments should be slightly more ambitious than the current baseline.`;
    case "codingStory":
      return `${common}Return JSON with this exact shape:
{
  "summary": "short paragraph",
  "moments": [
    { "title": "string", "narrative": "string" }
  ]
}
Rules:
- Provide 2 to 3 vivid moments.
- Include one positive or impressive moment with specific dates and files when the evidence supports it.
- Include one funny or failure moment.
- Include one cross-tool collaboration moment if both Claude Code and Codex were used.
- Write these as narrative moments, not statistical summaries.`;
  }
}

async function runInsightRounds(
  cliSpec: PtyResolvedLaunchSpec,
  analyzerCli: InsightsCliTool,
  stats: InsightsResult["stats"],
  sessions: SessionInfo[],
  facets: SessionFacet[],
  onProgress: (p: Omit<InsightsProgress, "jobId">) => void,
): Promise<InsightsResult> {
  const rounds: Exclude<InsightsSectionKey, "atAGlance">[] = [
    "projectAreas",
    "interactionStyle",
    "whatWorks",
    "frictionAnalysis",
    "suggestions",
    "onTheHorizon",
    "codingStory",
  ];

  let completed = 0;
  onProgress({
    stage: "analyzing",
    current: 0,
    total: rounds.length + 1,
    message: "Running structured analysis tasks...",
  });

  const sectionErrors: Partial<Record<InsightsSectionKey, string>> = {};
  const results: InsightsResult = {
    stats,
    projectAreas: null,
    interactionStyle: null,
    whatWorks: null,
    frictionAnalysis: null,
    suggestions: null,
    onTheHorizon: null,
    codingStory: null,
    atAGlance: buildDeterministicAtAGlance(stats),
    sectionErrors,
  };

  const sampledMessages = sampleRecentUserMessages(sessions);

  const tasks = await Promise.all(
    rounds.map(async (key) => {
      const dataCtx = buildAnalysisDataContext(key, stats, facets);
      try {
        const response = await invokeCli(
          cliSpec,
          analyzerCli,
          buildAnalysisPrompt(key, dataCtx, sampledMessages),
        );
        const parsed = parseStructuredSection(key, response);
        completed += 1;
        onProgress({
          stage: "analyzing",
          current: completed,
          total: rounds.length + 1,
          message: `Analyzing: ${key}`,
        });
        return { key, parsed } as const;
      } catch (err) {
        completed += 1;
        onProgress({
          stage: "analyzing",
          current: completed,
          total: rounds.length + 1,
          message: `Analyzing: ${key}`,
        });
        return {
          key,
          parsed: {
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          },
        } as const;
      }
    }),
  );

  for (const task of tasks) {
    if (task.parsed.ok) {
      (results as Record<string, unknown>)[task.key] = task.parsed.value;
    } else {
      sectionErrors[task.key] = task.parsed.error;
    }
  }

  const sectionContext = JSON.stringify(
    {
      stats,
      projectAreas: results.projectAreas,
      interactionStyle: results.interactionStyle,
      whatWorks: results.whatWorks,
      frictionAnalysis: results.frictionAnalysis,
      suggestions: results.suggestions,
      onTheHorizon: results.onTheHorizon,
      codingStory: results.codingStory,
    },
    null,
    2,
  );

  onProgress({
    stage: "analyzing",
    current: rounds.length,
    total: rounds.length + 1,
    message: "Generating at-a-glance summary",
  });

  try {
    const response = await invokeCli(
      cliSpec,
      analyzerCli,
      [
        "Write the final executive summary for an AI coding insights report.",
        "Return ONLY valid JSON with this exact shape:",
        '{ "headline": "string", "bullets": ["string"] }',
        "Provide 4 to 5 bullets. Ground them in the data. No markdown.",
        "",
        buildLanguageContext(sampledMessages),
        "",
        sectionContext,
      ].join("\n"),
    );
    const parsed = parseStructuredSection("atAGlance", response);
    if (parsed.ok) {
      results.atAGlance = parsed.value;
    } else {
      sectionErrors.atAGlance = parsed.error;
    }
  } catch (err) {
    sectionErrors.atAGlance = err instanceof Error ? err.message : String(err);
  }

  onProgress({
    stage: "analyzing",
    current: rounds.length + 1,
    total: rounds.length + 1,
    message: "At-a-glance ready",
  });

  return results;
}

export async function generateInsights(
  cliTool: InsightsCliTool,
  jobId: string,
  onProgress: (p: InsightsProgress) => void,
): Promise<InsightsGenerateResult> {
  const emit = (progress: Omit<InsightsProgress, "jobId">) =>
    onProgress({ jobId, ...progress });

  emit({
    stage: "validating",
    current: 0,
    total: 1,
    message: `Validating ${cliTool} CLI...`,
  });
  const validationErr = await validateCli(cliTool);
  if (validationErr) return { ok: false, jobId, error: validationErr };

  let cliSpec: PtyResolvedLaunchSpec;
  try {
    cliSpec = await resolveCliSpec(cliTool);
  } catch (err) {
    return {
      ok: false,
      jobId,
      error: {
        code: "cli_not_found",
        message: `Failed to resolve ${cliTool} CLI`,
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }

  emit({
    stage: "scanning",
    current: 0,
    total: 1,
    message: "Scanning Claude and Codex sessions...",
  });
  const { sessions: scannedSessions, totalScannedSessions } = await scanSessions(emit);
  const {
    eligibleSessions,
    facetEligibleSessions,
    metricsOnlySessions,
  } = selectSessionsForFacetExtraction(scannedSessions);
  if (eligibleSessions.length === 0) {
    return {
      ok: false,
      jobId,
      error: {
        code: "unknown",
        message: "No eligible Claude or Codex sessions found to analyze",
      },
    };
  }

  const facets: SessionFacet[] = [];
  const uncachedSessions: SessionInfo[] = [];
  let cachedFacetSessions = 0;
  let deferredFacetSessions = 0;
  let failedFacetSessions = 0;
  const facetBatchSize = getAdaptiveBatchSize(facetEligibleSessions.length);

  for (const session of facetEligibleSessions) {
    const cached = readCachedFacet(session, cliTool);
    if (cached) {
      facets.push(cached);
      cachedFacetSessions += 1;
      continue;
    }
    uncachedSessions.push(session);
  }

  emit({
    stage: "extracting_facets",
    current: 0,
    total: uncachedSessions.length,
    message:
      uncachedSessions.length > 0
        ? `Extracting rich facets with ${cliTool}...`
        : "Using cached facets...",
  });

  for (let i = 0; i < uncachedSessions.length; i += facetBatchSize) {
    const batch = uncachedSessions.slice(i, i + facetBatchSize);
    const results = await Promise.all(
      batch.map((session) => extractFacet(session, cliSpec, cliTool)),
    );
    for (const result of results) {
      if ("session_id" in result) {
        facets.push(result);
      } else {
        failedFacetSessions += 1;
      }
    }
    emit({
      stage: "extracting_facets",
      current: Math.min(i + batch.length, uncachedSessions.length),
      total: uncachedSessions.length,
      message: `Extracting facets: ${Math.min(i + batch.length, uncachedSessions.length)}/${uncachedSessions.length}`,
    });
    if (i + batch.length < uncachedSessions.length) await yieldToEventLoop();
  }

  emit({
    stage: "aggregating",
    current: 0,
    total: 1,
    message: "Aggregating statistics...",
  });
  const stats = aggregateFacets(facets, eligibleSessions, {
    sourceCli: "both",
    analyzerCli: cliTool,
    totalScannedSessions,
    totalEligibleSessions: eligibleSessions.length,
    cachedFacetSessions,
    failedFacetSessions,
    deferredFacetSessions,
    metricsOnlySessions,
  });

  const insightsResult = await runInsightRounds(
    cliSpec,
    cliTool,
    stats,
    eligibleSessions,
    facets,
    emit,
  );

  emit({
    stage: "generating_report",
    current: 0,
    total: 1,
    message: "Generating report...",
  });
  try {
    const reportPath = generateReport(insightsResult);
    return { ok: true, jobId, reportPath };
  } catch (err) {
    return {
      ok: false,
      jobId,
      error: {
        code: "unknown",
        message: "Failed to generate report",
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
