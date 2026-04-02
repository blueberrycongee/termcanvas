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
  PendingToolResult,
  StopReason,
  StreamEvent,
  SystemMessage,
  TextBlock,
  ThinkingBlock,
  ToolCallReturn,
  ToolResult,
  ToolResultBlock,
  ToolUseBlock,
  Usage,
  UserMessage,
} from "./types.ts";
export { emptyUsage, mergeUsage } from "./types.ts";

// Tool system
export type { APIToolSchema, PendingTask, ToolCall, ToolCallResult } from "./tool.ts";
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

// Model registry
export type { ModelCapability, ModelPricing } from "./model-registry.ts";
export {
  getModelCapability,
  getModelPricing,
  getContextWindow,
  getMaxOutputTokens,
  isOSeriesModel,
} from "./model-registry.ts";

// Error categorization
export type { ErrorCategory } from "./errors.ts";
export { categorizeError, isRetryableCategory, getRetryDelay } from "./errors.ts";

// Cost tracking
export type { CostState, TurnCost } from "./cost-tracker.ts";
export { CostTracker, calculateTurnCost } from "./cost-tracker.ts";

// Coordinator prompt
export type { CoordinatorPromptContext } from "./coordinator-prompt.ts";
export { buildCoordinatorPrompt } from "./coordinator-prompt.ts";

// Context injection
export type { SystemPromptConfig, EphemeralContext } from "./context-injection.ts";
export { buildFullSystemPrompt, buildSystemReminder, isSystemReminder, stripSystemReminders } from "./context-injection.ts";

// Tool hooks
export type {
  PermissionDecision,
  PreHook,
  PreHookContext,
  PreHookResult,
  PostHook,
  PostHookContext,
  PostHookResult,
  ToolHooks,
} from "./tool-hooks.ts";
export { runPreHooks, runPostHooks } from "./tool-hooks.ts";

// Built-in providers
export { AnthropicProvider } from "./provider/anthropic.ts";
export { OpenAIProvider } from "./provider/openai.ts";
