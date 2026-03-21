import crypto from "crypto";
import { execFile } from "child_process";
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

const CACHE_VERSION = 2;
const SESSION_META_CACHE_DIR = path.join(
  TERMCANVAS_DIR,
  "insights-cache",
  "session-meta",
);
const FACET_CACHE_DIR = path.join(TERMCANVAS_DIR, "insights-cache", "facets");
const SESSION_META_CACHE_BATCH = 50;
const SESSION_LOAD_BATCH = 10;
const MAX_UNCACHED_SESSION_LOADS = 200;
const MAX_FACET_EXTRACTIONS = 50;
const FACET_EXTRACTION_BATCH = 10;
const ANALYSIS_SAMPLE_LIMIT = 36;

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

function discoverSessionFiles(cliTool: InsightsCliTool): SessionFileInfo[] {
  const files =
    cliTool === "claude" ? findClaudeJsonlFiles() : findCodexJsonlFiles();
  const indexed: SessionFileInfo[] = [];

  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      indexed.push({
        id: path.basename(filePath, ".jsonl"),
        filePath,
        cliTool,
        mtimeMs: stat.mtimeMs,
        fileSize: stat.size,
      });
    } catch {
      // Ignore files that disappear mid-scan.
    }
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
    const cleaned = topDir.replace(/--worktrees-.*$/, "");
    projectPath = cleaned.replace(/-/g, "/");
  }

  const metrics = createEmptySessionMetrics();
  const toolNamesById = new Map<string, string>();
  const transcriptParts: string[] = [];
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
  sourceCli: InsightsCliTool,
  onProgress: (p: Omit<InsightsProgress, "jobId">) => void,
): Promise<ScanResult> {
  const files = discoverSessionFiles(sourceCli);
  const cachedSessions: SessionInfo[] = [];
  const uncachedFiles: SessionFileInfo[] = [];

  for (let i = 0; i < files.length; i += SESSION_META_CACHE_BATCH) {
    const batch = files.slice(i, i + SESSION_META_CACHE_BATCH);
    for (const file of batch) {
      const cached = readCachedSessionMeta(file);
      if (cached) {
        cachedSessions.push(cached);
      } else if (uncachedFiles.length < MAX_UNCACHED_SESSION_LOADS) {
        uncachedFiles.push(file);
      }
    }
    onProgress({
      stage: "scanning",
      current: Math.min(i + batch.length, files.length),
      total: files.length,
      message: `Scanning ${sourceCli} sessions...`,
    });
    if (i + batch.length < files.length) await yieldToEventLoop();
  }

  const loadedSessions: SessionInfo[] = [];
  for (let i = 0; i < uncachedFiles.length; i += SESSION_LOAD_BATCH) {
    const batch = uncachedFiles.slice(i, i + SESSION_LOAD_BATCH);
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
      message: `Loaded ${Math.min(i + batch.length, uncachedFiles.length)} new ${sourceCli} sessions`,
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
  const args = buildCliInvocationArgs(spec.args, cliTool, prompt);

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

export async function extractFacet(
  session: SessionInfo,
  cliSpec: PtyResolvedLaunchSpec,
  analyzerCli: InsightsCliTool,
): Promise<SessionFacet | InsightsError> {
  const cached = readCachedFacet(session, analyzerCli);
  if (cached) return cached;

  const prompt = [
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
    "- Return ONLY valid JSON. No markdown fences. No prose.",
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

function buildAnalysisDataContext(stats: InsightsResult["stats"], facets: SessionFacet[]): string {
  const sampleFacets = facets.slice(0, ANALYSIS_SAMPLE_LIMIT).map((facet) => ({
    session_id: facet.session_id,
    underlying_goal: facet.underlying_goal,
    brief_summary: facet.brief_summary,
    project_area: facet.project_area,
    outcome: facet.outcome,
    session_type: facet.session_type,
    notable_tools: facet.notable_tools,
    dominant_languages: facet.dominant_languages,
    wins: facet.wins,
    frictions: facet.frictions,
    recommended_next_step: facet.recommended_next_step,
  }));

  return JSON.stringify(
    {
      stats,
      sampleFacets,
    },
    null,
    2,
  );
}

function buildAnalysisPrompt(key: Exclude<InsightsSectionKey, "atAGlance">, dataCtx: string): string {
  const common = [
    "You are generating an executive-quality AI coding insights report.",
    "Use ONLY the provided data. Be specific. Ground claims in the metrics and sampled session facets.",
    "Keep strings concise and useful. No markdown. Return ONLY a valid JSON object.",
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
    case "funEnding":
      return `${common}Return JSON with this exact shape:
{
  "title": "string",
  "moment": "string",
  "whyItMatters": "string"
}
Rules:
- Pick one vivid, funny, or memorable session moment.
- The moment must still reveal something real about the workflow.`;
  }
}

async function runInsightRounds(
  cliSpec: PtyResolvedLaunchSpec,
  analyzerCli: InsightsCliTool,
  stats: InsightsResult["stats"],
  facets: SessionFacet[],
  onProgress: (p: Omit<InsightsProgress, "jobId">) => void,
): Promise<InsightsResult> {
  const dataCtx = buildAnalysisDataContext(stats, facets);
  const rounds: Exclude<InsightsSectionKey, "atAGlance">[] = [
    "projectAreas",
    "interactionStyle",
    "whatWorks",
    "frictionAnalysis",
    "suggestions",
    "onTheHorizon",
    "funEnding",
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
    funEnding: null,
    atAGlance: buildDeterministicAtAGlance(stats),
    sectionErrors,
  };

  const tasks = await Promise.all(
    rounds.map(async (key) => {
      try {
        const response = await invokeCli(
          cliSpec,
          analyzerCli,
          buildAnalysisPrompt(key, dataCtx),
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
      funEnding: results.funEnding,
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
    message: `Scanning ${cliTool} sessions...`,
  });
  const { sessions, totalScannedSessions } = await scanSessions(cliTool, emit);
  if (sessions.length === 0) {
    return {
      ok: false,
      jobId,
      error: {
        code: "unknown",
        message: `No valid ${cliTool} sessions found to analyze`,
      },
    };
  }

  const facets: SessionFacet[] = [];
  const uncachedSessions: SessionInfo[] = [];
  let cachedFacetSessions = 0;
  let deferredFacetSessions = 0;
  let failedFacetSessions = 0;

  for (const session of sessions) {
    const cached = readCachedFacet(session, cliTool);
    if (cached) {
      facets.push(cached);
      cachedFacetSessions += 1;
      continue;
    }
    if (uncachedSessions.length < MAX_FACET_EXTRACTIONS) {
      uncachedSessions.push(session);
    } else {
      deferredFacetSessions += 1;
    }
  }

  emit({
    stage: "extracting_facets",
    current: 0,
    total: uncachedSessions.length,
    message:
      uncachedSessions.length > 0
        ? `Extracting rich facets for ${cliTool} sessions...`
        : "Using cached facets...",
  });

  for (let i = 0; i < uncachedSessions.length; i += FACET_EXTRACTION_BATCH) {
    const batch = uncachedSessions.slice(i, i + FACET_EXTRACTION_BATCH);
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

  if (facets.length === 0) {
    return {
      ok: false,
      jobId,
      error: {
        code: "unknown",
        message: "Failed to load or extract any session facets",
      },
    };
  }

  emit({
    stage: "aggregating",
    current: 0,
    total: 1,
    message: "Aggregating statistics...",
  });
  const stats = aggregateFacets(facets, sessions, {
    sourceCli: cliTool,
    analyzerCli: cliTool,
    totalScannedSessions,
    totalEligibleSessions: sessions.length,
    cachedFacetSessions,
    failedFacetSessions,
    deferredFacetSessions,
  });

  const insightsResult = await runInsightRounds(
    cliSpec,
    cliTool,
    stats,
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
