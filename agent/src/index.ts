/**
 * TermCanvas Agent Runtime — public API.
 */

export type {
  AgentOptions,
  AssistantMessage,
  ContentBlock,
  LoopExitReason,
  LoopResult,
  Message,
  OnProgress,
  PendingToolResult,
  ProgressMessage,
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

export type { APIToolSchema, OnProgressFactory, PendingTask, ToolCall, ToolCallResult } from "./tool.ts";
export type { Tool } from "./tool.ts";
export { ToolRegistry, executeTools } from "./tool.ts";

export type { AgentEvent } from "./loop.ts";
export { agentLoop } from "./loop.ts";

export type {
  LLMProvider,
  ProviderConfig,
  StreamParams,
  ThinkingConfig,
} from "./provider/types.ts";

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

export type { CostState, TurnCost } from "./cost-tracker.ts";
export { CostTracker, calculateTurnCost } from "./cost-tracker.ts";

export type { CoordinatorPromptContext } from "./coordinator-prompt.ts";
export { buildCoordinatorPrompt } from "./coordinator-prompt.ts";

export type {
  ApprovalPolicy,
  PendingApproval,
  ApprovalDecision,
  ApprovalBridge,
} from "./approval-bridge.ts";
export { evaluateApproval } from "./approval-bridge.ts";

// Session persistence
export type { SessionConfig, TranscriptEntry, ResumedSession } from "./session.ts";
export { SessionWriter, generateSessionId, resumeSession } from "./session.ts";

export type { SystemPromptConfig, EphemeralContext } from "./context-injection.ts";
export { buildFullSystemPrompt, buildSystemReminder, isSystemReminder, stripSystemReminders } from "./context-injection.ts";

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

export type { WorkerStatus, WorkerState, WorkerStateChange, TelemetryCheckFn } from "./worker-state.ts";
export { WorkerTracker } from "./worker-state.ts";

export { AnthropicProvider } from "./provider/anthropic.ts";
export { OpenAIProvider } from "./provider/openai.ts";
