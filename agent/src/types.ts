/**
 * Core types for the TermCanvas agent runtime.
 *
 * Simplified from CC's type system — keeps only what an
 * orchestration-only (read-only + dispatch) agent needs.
 */

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ThinkingBlock;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface UserMessage {
  role: "user";
  content: string | (TextBlock | ToolResultBlock)[];
}

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  stop_reason?: StopReason;
  usage?: Usage;
}

export type Message = UserMessage | AssistantMessage;

export type StopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence"
  | null;

// ---------------------------------------------------------------------------
// Usage & cost
// ---------------------------------------------------------------------------

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0 };
}

export function mergeUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      (a.cache_creation_input_tokens ?? 0) +
      (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens:
      (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Stream events (yielded by provider and agent loop)
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "input_json_delta"; partial_json: string }
  | { type: "content_block_stop"; index: number }
  | { type: "message_start"; usage?: Usage }
  | { type: "message_delta"; stop_reason: StopReason; usage?: Usage }
  | { type: "error"; error: Error };

// ---------------------------------------------------------------------------
// Tool result (returned by Tool.call)
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: string;
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Agent loop control
// ---------------------------------------------------------------------------

export type LoopExitReason =
  | "completed"
  | "max_turns"
  | "aborted"
  | "error";

export interface LoopResult {
  reason: LoopExitReason;
  messages: Message[];
  totalUsage: Usage;
  turnCount: number;
}

// ---------------------------------------------------------------------------
// Agent options
// ---------------------------------------------------------------------------

export interface AgentOptions {
  /** System prompt sent to the LLM */
  systemPrompt: string;

  /** Maximum agentic turns before forced stop */
  maxTurns?: number;

  /** AbortSignal for cancellation */
  signal?: AbortSignal;

  /** Callback when a tool starts executing */
  onToolStart?: (name: string, input: Record<string, unknown>) => void;

  /** Callback when a tool finishes */
  onToolEnd?: (name: string, result: ToolResult) => void;
}
