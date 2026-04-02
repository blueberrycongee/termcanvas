/**
 * Claude Code headless driver — spawns Claude Code CLI as a child process
 * using the stream-json protocol and maps events to AgentStreamEvent.
 */

import { spawn, type ChildProcess } from "child_process";
import type { AgentStreamEvent } from "../src/types/index.ts";

// ---------------------------------------------------------------------------
// Types for Claude Code stream-json protocol (stdout NDJSON)
// ---------------------------------------------------------------------------

/** content_block_delta subtypes inside RawMessageStreamEvent */
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

/** Top-level stdout messages (subset we care about) */
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

type CCStdoutMessage =
  | CCSystemInit
  | CCStreamEvent
  | CCAssistantMessage
  | CCToolProgress
  | CCResult
  | CCControlRequest
  | { type: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Driver options
// ---------------------------------------------------------------------------

export interface ClaudeCodeDriverOptions {
  sessionId: string;
  cwd: string;
  env?: Record<string, string>;
  model?: string;
  permissionMode?: string;
  allowedTools?: string[];
  resumeSessionId?: string;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export class ClaudeCodeDriver {
  private proc: ChildProcess | null = null;
  private listeners: Array<(event: AgentStreamEvent) => void> = [];
  private buffer = "";
  private destroyed = false;
  private readonly options: ClaudeCodeDriverOptions;

  constructor(options: ClaudeCodeDriverOptions) {
    this.options = options;
  }

  /** Start the Claude Code CLI child process. */
  start(): void {
    if (this.proc) return;

    const args = [
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--print",
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

    this.proc = spawn("claude", args, {
      cwd: this.options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.proc.stdout?.setEncoding("utf-8");
    this.proc.stdout?.on("data", (chunk: string) => this.onStdoutData(chunk));
    this.proc.stderr?.setEncoding("utf-8");
    this.proc.stderr?.on("data", (chunk: string) => {
      // Forward stderr as error events
      this.emit({ type: "error", error: { message: chunk.trimEnd() } });
    });

    this.proc.on("exit", (_code, _signal) => {
      this.proc = null;
      if (!this.destroyed) {
        this.emit({ type: "stream_end" });
      }
    });

    this.proc.on("error", (err) => {
      this.emit({ type: "error", error: { message: err.message } });
    });
  }

  /** Send a user message via stdin NDJSON. */
  send(text: string): void {
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

  /** Kill the child process immediately. */
  abort(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM");
    }
  }

  /** Register an event listener. */
  onEvent(callback: (event: AgentStreamEvent) => void): void {
    this.listeners.push(callback);
  }

  /** Graceful shutdown: interrupt then wait for exit. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    if (!this.proc) return;

    // Send interrupt control_request to end session gracefully
    this.writeStdin({
      type: "control_request",
      request_id: `shutdown-${Date.now()}`,
      request: { subtype: "interrupt" },
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

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private emit(event: AgentStreamEvent): void {
    for (const cb of this.listeners) {
      cb(event);
    }
  }

  private writeStdin(msg: unknown): void {
    if (!this.proc?.stdin?.writable) return;
    // NDJSON: one JSON per line. Escape line separators per spec.
    const json = JSON.stringify(msg)
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    this.proc.stdin.write(json + "\n");
  }

  private onStdoutData(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as CCStdoutMessage;
        this.processMessage(msg);
      } catch {
        // Skip malformed lines
      }
    }
  }

  private processMessage(msg: CCStdoutMessage): void {
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
      default:
        // Ignore unknown message types (keep_alive, auth_status, etc.)
        break;
    }
  }

  private handleSystem(msg: CCSystemInit): void {
    if (msg.subtype === "init") {
      this.emit({ type: "stream_start" });
    }
  }

  private handleStreamEvent(msg: CCStreamEvent): void {
    const { event } = msg;
    if (!event) return;

    switch (event.type) {
      case "content_block_delta": {
        const delta = (event as ContentBlockDeltaText | ContentBlockDeltaThinking | ContentBlockDeltaInput).delta;
        if (delta.type === "text_delta") {
          this.emit({ type: "text_delta", text: (delta as { type: "text_delta"; text: string }).text });
        } else if (delta.type === "thinking_delta") {
          this.emit({ type: "thinking_delta", thinking: (delta as { type: "thinking_delta"; thinking: string }).thinking });
        }
        break;
      }
      case "content_block_start": {
        const block = (event as ContentBlockStartToolUse).content_block;
        if (block?.type === "tool_use") {
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
      if (block.type === "tool_use") {
        const tu = block as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
        this.emit({ type: "tool_use_start", id: tu.id, name: tu.name });
      }
    }
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
}
