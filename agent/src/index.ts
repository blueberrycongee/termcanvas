/**
 * TermCanvas Agent Runtime — public API.
 */

// Core types
export type {
  AgentOptions,
  AssistantMessage,
  ContentBlock,
  LoopExitReason,
  LoopResult,
  Message,
  StopReason,
  StreamEvent,
  TextBlock,
  ThinkingBlock,
  ToolResult,
  ToolResultBlock,
  ToolUseBlock,
  Usage,
  UserMessage,
} from "./types.ts";
export { emptyUsage, mergeUsage } from "./types.ts";

// Tool system
export type { APIToolSchema, ToolCall, ToolCallResult } from "./tool.ts";
export type { Tool } from "./tool.ts";
export { ToolRegistry, executeTools } from "./tool.ts";

// Agent loop
export type { AgentEvent } from "./loop.ts";
export { agentLoop } from "./loop.ts";

// Provider interface
export type {
  LLMProvider,
  ProviderConfig,
  StreamParams,
  ThinkingConfig,
} from "./provider/types.ts";

// Built-in providers
export { AnthropicProvider } from "./provider/anthropic.ts";
