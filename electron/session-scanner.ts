import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseSessionTelemetryLine, type SessionType } from "./session-watcher.ts";
import type { SessionInfo, TimelineEvent, ReplayTimeline } from "../shared/sessions.ts";

const SCAN_INTERVAL = 10_000;
const LIVE_THRESHOLD_MS = 60_000;
const FIND_TIMEOUT_MS = 5_000;
const TAIL_BYTES = 65536;

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

    execFile(
      "find",
      [claudeDir, "-maxdepth", "2", "-name", "*.jsonl", "-mmin", "-1440"],
      { timeout: FIND_TIMEOUT_MS },
      (err, stdout) => {
        if (err) return;

        const files = stdout.trim().split("\n").filter(Boolean);
        const now = Date.now();
        const results: SessionInfo[] = [];

        for (const filePath of files) {
          try {
            const stat = fs.statSync(filePath);
            const isLive = now - stat.mtimeMs < LIVE_THRESHOLD_MS;
            const sessionId = path.basename(filePath, ".jsonl");
            const projectKey = path.basename(path.dirname(filePath));

            const tail = this.readTail(filePath, stat.size);
            const parsed = this.parseTail(tail);

            results.push({
              sessionId,
              projectDir: projectKey,
              filePath,
              isLive,
              isManaged: false,
              status: parsed.status,
              currentTool: parsed.currentTool,
              startedAt: new Date(stat.birthtimeMs).toISOString(),
              lastActivityAt: new Date(stat.mtimeMs).toISOString(),
              messageCount: parsed.messageCount,
              tokenTotal: parsed.tokenTotal,
            });
          } catch {
            // skip unreadable files
          }
        }

        results.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
        this.sessions = results;
        this.onChange?.(results);
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

  private parseTail(tail: string): {
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
      const events = parseSessionTelemetryLine(line, "claude");
      for (const ev of events) {
        messageCount++;
        if (ev.token_total) tokenTotal = ev.token_total;
        if (ev.turn_state === "tool_running") {
          status = "tool_running";
          currentTool = ev.tool_name;
        } else if (ev.turn_state === "thinking" || ev.turn_state === "in_turn") {
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
    const projectDir = path.basename(path.dirname(filePath));

    const type: SessionType = filePath.includes(".codex") ? "codex" : "claude";
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

      const timestamp = typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString();
      const parsed = parseSessionTelemetryLine(line, type);

      // Inject user_prompt event for "type":"user" lines that contain actual user text
      if (raw.type === "user") {
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
      }

      for (const ev of parsed) {
        const timelineType = this.mapEventType(ev.event_type);
        if (!timelineType) continue;

        const textPreview = this.extractPreview(raw, ev.event_type);
        const toolFilePath = this.extractToolFilePath(raw, ev.tool_name);

        if (ev.token_total) totalTokens = ev.token_total;

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

        if (toolFilePath && (ev.tool_name === "Edit" || ev.tool_name === "Write")) {
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

  private mapEventType(eventType: string): TimelineEvent["type"] | null {
    switch (eventType) {
      case "thinking": return "thinking";
      case "tool_use": return "tool_use";
      case "tool_result": return "tool_result";
      case "assistant_message": return "assistant_text";
      case "turn_complete": return "turn_complete";
      case "user_message": return "user_prompt";
      case "assistant_stop": return null;
      case "queue_operation": return null;
      case "progress": return null;
      default: return null;
    }
  }

  private extractPreview(raw: Record<string, unknown>, _eventType: string): string {
    const message = raw.message as Record<string, unknown> | undefined;
    if (!message) return "";
    const content = message.content;
    if (typeof content === "string") return content.slice(0, 200);
    if (!Array.isArray(content)) return "";
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const entry = block as Record<string, unknown>;
      if (typeof entry.text === "string") return entry.text.slice(0, 200);
      if (typeof entry.thinking === "string") return entry.thinking.slice(0, 200);
      if (typeof entry.input === "object" && entry.input) {
        const input = entry.input as Record<string, unknown>;
        if (typeof input.command === "string") return `$ ${input.command.slice(0, 180)}`;
        if (typeof input.file_path === "string") return input.file_path;
      }
    }
    return "";
  }

  private extractUserPromptText(raw: Record<string, unknown>): string {
    const message = raw.message as Record<string, unknown> | undefined;
    if (!message) return "";
    const content = message.content;
    if (typeof content === "string") return content.slice(0, 200);
    if (!Array.isArray(content)) return "";
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const entry = block as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") return entry.text.slice(0, 200);
      if (entry.type === "tool_result") continue;
    }
    return "";
  }

  private extractToolFilePath(raw: Record<string, unknown>, toolName?: string): string | undefined {
    if (!toolName || !["Edit", "Write", "Read", "Glob", "Grep"].includes(toolName)) return undefined;
    const message = raw.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? message!.content : [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const entry = block as Record<string, unknown>;
      if (entry.type === "tool_use" && typeof entry.input === "object" && entry.input) {
        const input = entry.input as Record<string, unknown>;
        if (typeof input.file_path === "string") return input.file_path;
        if (typeof input.path === "string") return input.path;
      }
    }
    return undefined;
  }
}
