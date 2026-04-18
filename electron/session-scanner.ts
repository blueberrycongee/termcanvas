import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseSessionTelemetryLine,
  type SessionType,
} from "./session-watcher.ts";
import type {
  SessionInfo,
  TimelineEvent,
  ReplayTimeline,
} from "../shared/sessions.ts";
import type { NormalizedSessionTelemetryEvent } from "../shared/telemetry.ts";
import { findCodexJsonlFiles } from "./usage-collector.ts";

const SCAN_INTERVAL = 10_000;
const LIVE_THRESHOLD_MS = 60_000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const FIND_TIMEOUT_MS = 5_000;
const TAIL_BYTES = 65536;
// Per-message cap for replay-timeline content. The old 200-char cap
// was fine for "a one-line preview in a sidebar list" but turned the
// full-fidelity replay into a chopped-off log — users couldn't
// actually read a conversation end-to-end because every message got
// truncated mid-sentence. 16 KB comfortably covers the 95th-
// percentile assistant response and keeps a ceiling so a runaway
// tool output (e.g. `cat` on a big file) can't pull 500 KB of string
// into every timeline event. Anything past this gets slice-truncated;
// the UI treats that as acceptable lossy display.
const REPLAY_TEXT_MAX_CHARS = 16_000;

/**
 * Remove the noise Claude Code / Codex inject into user messages:
 *
 *  - `<system-reminder>...</system-reminder>` wrappers, which is
 *    where CLAUDE.md / AGENTS.md content lands on the first user
 *    turn. Users who saw these as the "first prompt" complained —
 *    it hid the actual question they asked.
 *  - `<local-command-caveat>`, `<command-name>`, `<command-message>`,
 *    `<command-args>`, `<command-stdout>`, `<command-type>` blocks
 *    that the `/resume`, `/compact`, and other slash-command flows
 *    emit as pseudo-user messages. They're housekeeping, not prose.
 *
 * If nothing is left after stripping, the message is treated as
 * entirely synthetic and skipped (no user_prompt event emitted,
 * no "first prompt" captured for the browse list).
 */
export function stripSyntheticUserBlocks(text: string): string {
  let out = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/gi, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/gi, "")
    .replace(/<command-stdout>[\s\S]*?<\/command-stdout>/gi, "")
    .replace(/<command-type>[\s\S]*?<\/command-type>/gi, "")
    // Codex wraps AGENTS.md / developer instructions in a family of
    // XML-ish tags depending on version. These are the ones I've
    // seen; widen if we find more. Non-greedy, multiline so the
    // whole content gets snipped out whether it's on one line or
    // many.
    .replace(/<user_instructions>[\s\S]*?<\/user_instructions>/gi, "")
    .replace(/<user-instructions>[\s\S]*?<\/user-instructions>/gi, "")
    .replace(/<agents_md>[\s\S]*?<\/agents_md>/gi, "")
    .replace(/<agent_instructions>[\s\S]*?<\/agent_instructions>/gi, "")
    .replace(/<developer>[\s\S]*?<\/developer>/gi, "")
    .replace(/<project_context>[\s\S]*?<\/project_context>/gi, "")
    .replace(/<project-context>[\s\S]*?<\/project-context>/gi, "")
    .trim();

  // Fallback: some Codex versions inject a markdown-style heading
  // followed by the file content (e.g. "# AGENTS.md\n..."). If the
  // trimmed text *starts* with a CLAUDE.md / AGENTS.md reference and
  // the first few hundred characters look like file-content prose
  // rather than a question, drop up to the first blank-line boundary
  // and use what's after. Conservative — we only skip when the
  // opener unambiguously names the file.
  const headingRe = /^(#\s*)?(CLAUDE|AGENTS)\.md\b[\s\S]*?\n\s*\n/i;
  const stripped = out.replace(headingRe, "").trim();
  if (stripped.length > 0 && stripped !== out) out = stripped;

  return out;
}

export class SessionScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sessions: SessionInfo[] = [];
  private onChange: ((sessions: SessionInfo[]) => void) | null = null;

  start(onChange: (sessions: SessionInfo[]) => void): void {
    this.onChange = onChange;
    this.scan();
    this.timer = setInterval(() => this.scan(), SCAN_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSessions(): SessionInfo[] {
    return this.sessions;
  }

  private scan(): void {
    const claudeDir = path.join(os.homedir(), ".claude", "projects");
    const finalize = (claudeFiles: string[]) => {
      const now = Date.now();
      const results: SessionInfo[] = [];
      const files = [
        ...claudeFiles.map((filePath) => ({
          filePath,
          type: "claude" as const,
        })),
        ...findCodexJsonlFiles().map((filePath) => ({
          filePath,
          type: "codex" as const,
        })),
      ];

      for (const { filePath, type } of files) {
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > HISTORY_WINDOW_MS) {
            continue;
          }

          const isLive = now - stat.mtimeMs < LIVE_THRESHOLD_MS;
          const sessionId = path.basename(filePath, ".jsonl");
          const projectDir = this.resolveProjectDir(filePath, type, sessionId);
          const tail = this.readTail(filePath, stat.size);
          const parsed = this.parseTail(tail, type);

          // If the session file hasn't been modified recently, the agent is no
          // longer active.  Downgrade in-progress statuses so stale sessions
          // don't appear as "Thinking" / "Running" in the sidebar.
          let status = parsed.status;
          if (
            !isLive &&
            (status === "generating" || status === "tool_running")
          ) {
            status = "idle";
          }

          results.push({
            sessionId,
            projectDir,
            filePath,
            isLive,
            isManaged: false,
            status,
            currentTool: isLive ? parsed.currentTool : undefined,
            startedAt: new Date(stat.birthtimeMs).toISOString(),
            lastActivityAt: new Date(stat.mtimeMs).toISOString(),
            messageCount: parsed.messageCount,
            tokenTotal: parsed.tokenTotal,
          });
        } catch {}
      }

      results.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      this.sessions = results;
      this.onChange?.(results);
    };

    if (!fs.existsSync(claudeDir)) {
      finalize([]);
      return;
    }

    execFile(
      "find",
      [claudeDir, "-maxdepth", "2", "-name", "*.jsonl", "-mmin", "-1440"],
      { timeout: FIND_TIMEOUT_MS },
      (err, stdout) => {
        if (err) {
          finalize([]);
          return;
        }
        finalize(stdout.trim().split("\n").filter(Boolean));
      },
    );
  }

  private readTail(filePath: string, fileSize: number): string {
    const start = Math.max(0, fileSize - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(TAIL_BYTES, fileSize));
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
  }

  private parseTail(
    tail: string,
    type: SessionType,
  ): {
    status: SessionInfo["status"];
    currentTool?: string;
    messageCount: number;
    tokenTotal: number;
  } {
    const lines = tail.split("\n").filter(Boolean);
    let messageCount = 0;
    let tokenTotal = 0;
    let status: SessionInfo["status"] = "idle";
    let currentTool: string | undefined;

    for (const line of lines) {
      const events = parseSessionTelemetryLine(line, type);
      for (const ev of events) {
        messageCount++;
        if (ev.token_total) tokenTotal = ev.token_total;
        if (ev.turn_state === "tool_running") {
          status = "tool_running";
          currentTool = ev.tool_name;
        } else if (
          ev.turn_state === "thinking" ||
          ev.turn_state === "in_turn"
        ) {
          status = "generating";
        } else if (ev.turn_state === "turn_complete") {
          status = "turn_complete";
          currentTool = undefined;
        }
      }
    }
    return { status, currentTool, messageCount, tokenTotal };
  }

  async loadReplay(filePath: string): Promise<ReplayTimeline> {
    const content = await fsp.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const sessionId = path.basename(filePath, ".jsonl");
    const type = this.detectSessionType(filePath, lines);
    const projectDir = this.resolveProjectDir(filePath, type, sessionId, lines);
    const events: TimelineEvent[] = [];
    const editIndices: Array<{ index: number; filePath: string }> = [];
    let totalTokens = 0;

    for (const line of lines) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }

      const timestamp =
        typeof raw.timestamp === "string"
          ? raw.timestamp
          : new Date().toISOString();
      const parsed = parseSessionTelemetryLine(line, type);

      const userText = this.extractUserPromptText(raw);
      if (userText) {
        const idx = events.length;
        events.push({
          index: idx,
          timestamp,
          type: "user_prompt",
          textPreview: userText,
        });
      }

      for (const ev of parsed) {
        if (ev.token_total) totalTokens = ev.token_total;
        const timelineType = this.mapEventType(ev);
        if (!timelineType) continue;

        const textPreview = this.extractPreview(raw, ev);
        const toolFilePath = this.extractToolFilePath(raw, ev.tool_name);

        const idx = events.length;
        events.push({
          index: idx,
          timestamp: ev.at ?? timestamp,
          type: timelineType,
          toolName: ev.tool_name,
          filePath: toolFilePath,
          textPreview,
          tokenDelta: ev.token_total,
        });

        if (
          toolFilePath &&
          (ev.tool_name === "Edit" ||
            ev.tool_name === "Write" ||
            ev.tool_name === "apply_patch")
        ) {
          editIndices.push({ index: idx, filePath: toolFilePath });
        }
      }
    }

    return {
      sessionId,
      projectDir,
      filePath,
      events,
      editIndices,
      totalTokens,
      startedAt: events[0]?.timestamp ?? "",
      endedAt: events[events.length - 1]?.timestamp ?? "",
    };
  }

  private mapEventType(
    event: NormalizedSessionTelemetryEvent,
  ): TimelineEvent["type"] | null {
    switch (event.event_type) {
      case "thinking":
        return "thinking";
      case "reasoning":
        return "thinking";
      case "tool_use":
        return "tool_use";
      case "function_call":
        return "tool_use";
      case "custom_tool_call":
        return "tool_use";
      case "exec_command_begin":
        return "tool_use";
      case "patch_apply_begin":
        return "tool_use";
      case "web_search_begin":
        return "tool_use";
      case "mcp_tool_call_begin":
        return "tool_use";
      case "tool_result":
        return "tool_result";
      case "function_call_output":
        return "tool_result";
      case "custom_tool_call_output":
        return "tool_result";
      case "exec_command_end":
        return "tool_result";
      case "patch_apply_end":
        return "tool_result";
      case "web_search_end":
        return "tool_result";
      case "mcp_tool_call_end":
        return "tool_result";
      case "assistant_message":
        return "assistant_text";
      case "agent_message":
        return "assistant_text";
      case "message":
        return event.role === "assistant" ? "assistant_text" : null;
      case "turn_complete":
        return "turn_complete";
      case "task_complete":
        return "turn_complete";
      case "turn_aborted":
        return "error";
      case "error":
        return "error";
      case "user_message":
        return null;
      case "assistant_stop":
        return null;
      case "task_started":
        return null;
      case "token_count":
        return null;
      case "context_compacted":
        return null;
      case "compacted":
        return null;
      case "queue_operation":
        return null;
      case "progress":
        return null;
      default:
        return null;
    }
  }

  private extractPreview(
    raw: Record<string, unknown>,
    event: NormalizedSessionTelemetryEvent,
  ): string {
    const message = raw.message as Record<string, unknown> | undefined;
    if (message) {
      const preview = this.extractTextFromContent(message.content);
      if (preview) return preview;
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (!block || typeof block !== "object") continue;
          const entry = block as Record<string, unknown>;
          if (typeof entry.input === "object" && entry.input) {
            const input = entry.input as Record<string, unknown>;
            if (typeof input.command === "string")
              return `$ ${input.command.slice(0, 180)}`;
            if (typeof input.file_path === "string") return input.file_path;
          }
        }
      }
    }

    const payload = this.getObject(raw.payload);
    if (!payload) return "";

    if (
      raw.type === "event_msg" &&
      (payload.type === "user_message" || payload.type === "agent_message") &&
      typeof payload.message === "string"
    ) {
      return payload.message.slice(0, REPLAY_TEXT_MAX_CHARS);
    }

    if (raw.type !== "response_item") {
      return "";
    }

    if (payload.type === "message") {
      return this.extractTextFromContent(payload.content);
    }

    if (payload.type === "reasoning") {
      return this.extractTextFromContent(payload.summary);
    }

    if (
      payload.type === "function_call" ||
      payload.type === "custom_tool_call"
    ) {
      const input = this.extractCodexToolInput(payload);
      if (typeof input?.command === "string")
        return `$ ${input.command.slice(0, 180)}`;
      if (typeof input?.cmd === "string") return `$ ${input.cmd.slice(0, 180)}`;
      if (typeof input?.file_path === "string") return input.file_path;
      if (typeof input?.path === "string") return input.path;
      if (typeof payload.arguments === "string")
        return payload.arguments.slice(0, REPLAY_TEXT_MAX_CHARS);
      if (
        typeof payload.input === "string" &&
        event.tool_name !== "apply_patch"
      ) {
        return payload.input.slice(0, REPLAY_TEXT_MAX_CHARS);
      }
    }

    if (
      (payload.type === "function_call_output" ||
        payload.type === "custom_tool_call_output") &&
      typeof payload.output === "string"
    ) {
      return payload.output.slice(0, REPLAY_TEXT_MAX_CHARS);
    }

    return "";
  }

  private extractUserPromptText(raw: Record<string, unknown>): string {
    // Claude stores both user input AND assistant replies in the same
    // `message.content` shape (a text block). The only thing that
    // distinguishes them is the outer `raw.type` ("user" vs "assistant").
    // Without that guard, every assistant text line would be mis-tagged
    // as a user prompt *and* also come through as an assistant_text event,
    // causing every agent reply to render twice in the replay — once
    // incorrectly as a "you" bubble, once correctly as assistant prose.
    // That's exactly the "I can't tell my messages from the agent's" bug.
    if (raw.type === "user") {
      // `isMeta: true` marks synthetic caveats / command banners that
      // Claude Code injects (e.g. "<local-command-caveat>", the
      // /resume/compact command headers). They aren't real user text
      // and shouldn't become topic headers in the replay view.
      if (raw.isMeta === true) return "";
      const message = raw.message as Record<string, unknown> | undefined;
      if (message) {
        const content = message.content;
        let rawText = "";
        if (typeof content === "string") {
          rawText = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const entry = block as Record<string, unknown>;
            if (entry.type === "text" && typeof entry.text === "string") {
              rawText = entry.text;
              break;
            }
            if (entry.type === "tool_result") continue;
          }
        }
        if (rawText) {
          const cleaned = stripSyntheticUserBlocks(rawText);
          if (cleaned) return cleaned.slice(0, REPLAY_TEXT_MAX_CHARS);
        }
      }
    }

    // Codex. Apply the same synthetic-block stripping as the Claude
    // branch above — Codex wraps AGENTS.md injections in
    // `<system-reminder>` tags on the first user turn just like
    // Claude does with CLAUDE.md. Without this the replay topic
    // would show the project instructions instead of the actual
    // first question.
    const payload = this.getObject(raw.payload);
    if (!payload) return "";
    if (
      raw.type === "event_msg" &&
      payload.type === "user_message" &&
      typeof payload.message === "string"
    ) {
      const cleaned = stripSyntheticUserBlocks(payload.message);
      return cleaned ? cleaned.slice(0, REPLAY_TEXT_MAX_CHARS) : "";
    }
    if (
      raw.type === "response_item" &&
      payload.type === "message" &&
      payload.role === "user"
    ) {
      const text = this.extractTextFromContent(payload.content);
      const cleaned = stripSyntheticUserBlocks(text);
      return cleaned ? cleaned.slice(0, REPLAY_TEXT_MAX_CHARS) : "";
    }
    return "";
  }

  private extractToolFilePath(
    raw: Record<string, unknown>,
    toolName?: string,
  ): string | undefined {
    const message = raw.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message!.content : [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const entry = block as Record<string, unknown>;
      if (
        entry.type === "tool_use" &&
        typeof entry.input === "object" &&
        entry.input
      ) {
        const input = entry.input as Record<string, unknown>;
        if (typeof input.file_path === "string") return input.file_path;
        if (typeof input.path === "string") return input.path;
      }
    }

    const payload = this.getObject(raw.payload);
    if (
      toolName &&
      payload &&
      raw.type === "response_item" &&
      (payload.type === "function_call" || payload.type === "custom_tool_call")
    ) {
      const input = this.extractCodexToolInput(payload);
      const candidate =
        typeof input?.file_path === "string"
          ? input.file_path
          : typeof input?.path === "string"
            ? input.path
            : typeof input?.filePath === "string"
              ? input.filePath
              : typeof input?.oldPath === "string"
                ? input.oldPath
                : typeof input?.newPath === "string"
                  ? input.newPath
                  : undefined;
      if (candidate) return candidate;
    }

    return undefined;
  }

  private detectSessionType(filePath: string, lines: string[]): SessionType {
    const normalizedPath = filePath.replace(/\\/g, "/");
    if (normalizedPath.includes("/.codex/")) return "codex";
    if (normalizedPath.includes("/.claude/")) return "claude";

    for (const line of lines.slice(0, 20)) {
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        if (
          raw.type === "session_meta" ||
          raw.type === "event_msg" ||
          raw.type === "response_item" ||
          raw.type === "compacted"
        ) {
          return "codex";
        }
        if (
          raw.type === "assistant" ||
          raw.type === "user" ||
          raw.type === "system" ||
          raw.type === "queue-operation" ||
          raw.type === "progress"
        ) {
          return "claude";
        }
      } catch {}
    }

    return "claude";
  }

  private resolveProjectDir(
    filePath: string,
    type: SessionType,
    sessionId: string,
    lines?: string[],
  ): string {
    if (type === "claude") {
      return path.basename(path.dirname(filePath));
    }

    return this.readCodexProjectDir(filePath, lines) ?? sessionId;
  }

  private readCodexProjectDir(
    filePath: string,
    lines?: string[],
  ): string | null {
    const sourceLines = lines ?? this.readHeadLines(filePath, 20);
    for (const line of sourceLines) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const payload = this.getObject(raw.payload);
        if (
          raw.type === "session_meta" &&
          typeof payload?.cwd === "string" &&
          payload.cwd
        ) {
          return payload.cwd;
        }
      } catch {}
    }
    return null;
  }

  private readHeadLines(filePath: string, maxLines: number): string[] {
    try {
      return fs.readFileSync(filePath, "utf-8").split("\n").slice(0, maxLines);
    } catch {
      return [];
    }
  }

  private getObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  }

  private extractTextFromContent(content: unknown): string {
    if (typeof content === "string") return content.slice(0, REPLAY_TEXT_MAX_CHARS);
    if (!Array.isArray(content)) return "";
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const entry = block as Record<string, unknown>;
      if (typeof entry.text === "string") return entry.text.slice(0, REPLAY_TEXT_MAX_CHARS);
      if (typeof entry.thinking === "string")
        return entry.thinking.slice(0, REPLAY_TEXT_MAX_CHARS);
      if (typeof entry.content === "string") return entry.content.slice(0, REPLAY_TEXT_MAX_CHARS);
    }
    return "";
  }

  private extractCodexToolInput(
    payload: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (typeof payload.arguments === "string") {
      try {
        const parsed = JSON.parse(payload.arguments);
        return this.getObject(parsed);
      } catch {}
    } else {
      const directArgs = this.getObject(payload.arguments);
      if (directArgs) return directArgs;
    }

    if (typeof payload.input === "string") {
      try {
        const parsed = JSON.parse(payload.input);
        return this.getObject(parsed);
      } catch {
        return null;
      }
    }

    return this.getObject(payload.input);
  }
}
