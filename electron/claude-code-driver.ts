/**
 * Claude Code headless driver — spawns Claude Code CLI as a child process
 * using the stream-json protocol and maps events to AgentStreamEvent.
 */

import { spawn, type ChildProcess } from "child_process";
import type { AgentStreamEvent } from "../src/types/index.ts";

const isDev = !!process.env.VITE_DEV_SERVER_URL;

interface ContentBlockDeltaText {
  type: "content_block_delta";
  delta: { type: "text_delta"; text: string };
}

interface ContentBlockDeltaThinking {
  type: "content_block_delta";
  delta: { type: "thinking_delta"; thinking: string };
}

interface ContentBlockDeltaInput {
  type: "content_block_delta";
  delta: { type: "input_json_delta"; partial_json: string };
}

interface ContentBlockStartToolUse {
  type: "content_block_start";
  content_block: { type: "tool_use"; id: string; name: string };
}

type StreamEventInner =
  | ContentBlockDeltaText
  | ContentBlockDeltaThinking
  | ContentBlockDeltaInput
  | ContentBlockStartToolUse
  | { type: string; [key: string]: unknown };

interface CCSystemInit {
  type: "system";
  subtype: "init";
  session_id: string;
  [key: string]: unknown;
}

interface CCStreamEvent {
  type: "stream_event";
  event: StreamEventInner;
  parent_tool_use_id: string | null;
  [key: string]: unknown;
}

interface CCAssistantMessage {
  type: "assistant";
  message: {
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      | { type: "thinking"; thinking: string }
      | { type: string; [key: string]: unknown }
    >;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CCToolProgress {
  type: "tool_progress";
  tool_use_id: string;
  tool_name: string;
  [key: string]: unknown;
}

interface CCResult {
  type: "result";
  subtype: string;
  is_error?: boolean;
  result?: string;
  [key: string]: unknown;
}

interface CCControlRequest {
  type: "control_request";
  request_id: string;
  request: {
    subtype: string;
    tool_name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    [key: string]: unknown;
  };
}

interface CCToolUseSummary {
  type: "tool_use_summary";
  tool_use_id: string;
  tool_name: string;
  result?: string;
  is_error?: boolean;
  [key: string]: unknown;
}

type CCStdoutMessage =
  | CCSystemInit
  | CCStreamEvent
  | CCAssistantMessage
  | CCToolProgress
  | CCResult
  | CCControlRequest
  | CCToolUseSummary
  | { type: string; [key: string]: unknown };

export interface ClaudeCodeDriverOptions {
  sessionId: string;
  cwd: string;
  env?: Record<string, string>;
  model?: string;
  permissionMode?: string;
  allowedTools?: string[];
  resumeSessionId?: string;
}

export class ClaudeCodeDriver {
  private proc: ChildProcess | null = null;
  private listeners: Array<(event: AgentStreamEvent) => void> = [];
  private buffer = "";
  private destroyed = false;
  private readonly options: ClaudeCodeDriverOptions;
  private emittedToolIds = new Set<string>();
  private streamedText = false;
  cachedSlashCommands: string[] | null = null;

  constructor(options: ClaudeCodeDriverOptions) {
    this.options = options;
  }

  start(): void {
    if (this.proc) return;

    const args = [
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--print",
      "--verbose",
      "--include-partial-messages",
    ];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }
    if (this.options.permissionMode) {
      args.push("--permission-mode", this.options.permissionMode);
    }
    if (this.options.allowedTools) {
      for (const tool of this.options.allowedTools) {
        args.push("--allowedTools", tool);
      }
    }
    if (this.options.resumeSessionId) {
      args.push("--resume", this.options.resumeSessionId);
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...this.options.env,
    };

    if (isDev) console.log("[ClaudeCodeDriver] start:", { args, cwd: this.options.cwd, sessionId: this.options.sessionId });

    this.proc = spawn("claude", args, {
      cwd: this.options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (isDev) console.log("[ClaudeCodeDriver] process spawned, pid:", this.proc.pid);

    this.proc.stdout?.setEncoding("utf-8");
    this.proc.stdout?.on("data", (chunk: string) => {
      if (isDev) console.log("[ClaudeCodeDriver] stdout chunk:", chunk.slice(0, 200));
      this.onStdoutData(chunk);
    });
    this.proc.stderr?.setEncoding("utf-8");
    this.proc.stderr?.on("data", (chunk: string) => {
      if (isDev) console.log("[ClaudeCodeDriver] stderr:", chunk.trimEnd());
    });

    this.proc.on("exit", (code, signal) => {
      if (isDev) console.log("[ClaudeCodeDriver] process exited, code:", code, "signal:", signal);
      this.proc = null;
      if (!this.destroyed) {
        this.emit({ type: "stream_end" });
      }
    });

    this.proc.on("error", (err) => {
      if (isDev) console.log("[ClaudeCodeDriver] process error:", err.message);
      this.emit({ type: "error", error: { message: err.message } });
    });
  }

  send(text: string): void {
    if (isDev) console.log("[ClaudeCodeDriver] send:", text.slice(0, 100), "| proc alive:", !!this.proc, "| stdin writable:", !!this.proc?.stdin?.writable);
    this.writeStdin({
      type: "user",
      message: { role: "user", content: text },
      session_id: this.options.sessionId,
      parent_tool_use_id: null,
    });
  }

  /** Approve a pending tool-use permission request. */
  approve(requestId: string): void {
    this.writeStdin({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: { behavior: "allow" },
      },
    });
  }

  /** Deny a pending tool-use permission request. */
  deny(requestId: string, reason?: string): void {
    this.writeStdin({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: {
          behavior: "deny",
          message: reason ?? "Denied by user",
        },
      },
    });
  }

  abort(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM");
    }
  }

  onEvent(callback: (event: AgentStreamEvent) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  /** Graceful shutdown: interrupt then wait for exit. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    if (!this.proc) return;

    // Send end_session control_request to end session gracefully
    this.writeStdin({
      type: "control_request",
      request_id: `shutdown-${Date.now()}`,
      request: { subtype: "end_session" },
    });

    // Wait for exit with a timeout
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.proc?.kill("SIGKILL");
        resolve();
      }, 5000);

      if (this.proc) {
        this.proc.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    this.proc = null;
    this.listeners = [];
  }

  private emit(event: AgentStreamEvent): void {
    for (const cb of this.listeners) {
      cb(event);
    }
  }

  private writeStdin(msg: unknown): void {
    if (!this.proc?.stdin?.writable) return;
    const json = JSON.stringify(msg)
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    this.proc.stdin.write(json + "\n");
  }

  private onStdoutData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as CCStdoutMessage;
        this.processMessage(msg);
      } catch {
      }
    }
  }

  private processMessage(msg: CCStdoutMessage): void {
    if (isDev) console.log("[ClaudeCodeDriver] event:", msg.type, "subtype" in msg ? (msg as { subtype?: string }).subtype : "");
    switch (msg.type) {
      case "system":
        this.handleSystem(msg as CCSystemInit);
        break;
      case "stream_event":
        this.handleStreamEvent(msg as CCStreamEvent);
        break;
      case "assistant":
        this.handleAssistant(msg as CCAssistantMessage);
        break;
      case "tool_progress":
        this.handleToolProgress(msg as CCToolProgress);
        break;
      case "result":
        this.handleResult(msg as CCResult);
        break;
      case "control_request":
        this.handleControlRequest(msg as CCControlRequest);
        break;
      case "tool_use_summary":
        this.handleToolUseSummary(msg as CCToolUseSummary);
        break;
      default:
        break;
    }
  }

  private handleSystem(msg: CCSystemInit): void {
    if (msg.subtype === "init") {
      this.emit({ type: "stream_start" });
      this.emit({
        type: "system_init",
        model: msg.model as string | undefined,
        tools_count: typeof msg.tools === "number" ? msg.tools : Array.isArray(msg.tools) ? (msg.tools as unknown[]).length : undefined,
        session_id: msg.session_id,
        slash_commands: Array.isArray(msg.slash_commands) ? msg.slash_commands as string[] : undefined,
      });
      if (Array.isArray(msg.slash_commands)) {
        this.cachedSlashCommands = msg.slash_commands as string[];
      }
    }
  }

  private handleStreamEvent(msg: CCStreamEvent): void {
    const { event } = msg;
    if (!event) return;

    switch (event.type) {
      case "content_block_delta": {
        const delta = (event as ContentBlockDeltaText | ContentBlockDeltaThinking | ContentBlockDeltaInput).delta;
        if (delta.type === "text_delta") {
          this.streamedText = true;
          this.emit({ type: "text_delta", text: (delta as { type: "text_delta"; text: string }).text });
        } else if (delta.type === "thinking_delta") {
          this.emit({ type: "thinking_delta", thinking: (delta as { type: "thinking_delta"; thinking: string }).thinking });
        }
        break;
      }
      case "content_block_start": {
        const block = (event as ContentBlockStartToolUse).content_block;
        if (block?.type === "tool_use") {
          this.emittedToolIds.add(block.id);
          this.emit({ type: "tool_use_start", id: block.id, name: block.name });
        }
        break;
      }
      default:
        break;
    }
  }

  private handleAssistant(msg: CCAssistantMessage): void {
    const content = msg.message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === "text" && !this.streamedText) {
        // Only emit if we didn't already stream this text via stream_event
        const tb = block as { type: "text"; text: string };
        this.emit({ type: "text_delta", text: tb.text });
      } else if (block.type === "thinking") {
      } else if (block.type === "tool_use") {
        const tu = block as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
        if (!this.emittedToolIds.has(tu.id)) {
          this.emit({ type: "tool_use_start", id: tu.id, name: tu.name });
        }
        this.emit({ type: "tool_start", name: tu.name, input: tu.input });
      }
    }

    this.streamedText = false;
  }

  private handleToolProgress(msg: CCToolProgress): void {
    this.emit({
      type: "tool_start",
      name: msg.tool_name,
      input: {},
    });
  }

  private handleResult(msg: CCResult): void {
    if (msg.is_error) {
      const errorText = typeof msg.result === "string" ? msg.result : "Unknown error";
      this.emit({ type: "error", error: { message: errorText } });
    }
    this.emit({
      type: "result_info",
      cost_usd: typeof msg.cost_usd === "number" ? msg.cost_usd : typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined,
      input_tokens: typeof msg.input_tokens === "number" ? msg.input_tokens : (msg.usage as Record<string, unknown> | undefined)?.input_tokens as number | undefined,
      output_tokens: typeof msg.output_tokens === "number" ? msg.output_tokens : (msg.usage as Record<string, unknown> | undefined)?.output_tokens as number | undefined,
      duration_ms: typeof msg.duration_ms === "number" ? msg.duration_ms : undefined,
      num_turns: typeof msg.num_turns === "number" ? msg.num_turns : undefined,
    });
    this.emit({ type: "stream_end" });
  }

  private handleControlRequest(msg: CCControlRequest): void {
    const { request } = msg;
    if (request.subtype === "can_use_tool") {
      this.emit({
        type: "approval_request",
        request_id: msg.request_id,
        tool_name: request.tool_name ?? "unknown",
        tool_input: request.input ?? {},
      });
    }
  }

  private handleToolUseSummary(msg: CCToolUseSummary): void {
    this.emit({
      type: "tool_end",
      name: msg.tool_name,
      content: msg.result ?? "",
      is_error: msg.is_error,
    });
  }
}
