/**
 * LLM provider interface — pluggable backend for the agent loop.
 *
 * Each provider implements stream(): takes messages + tools,
 * returns an async generator of stream events and a final
 * AssistantMessage.
 */

import type {
  AssistantMessage,
  Message,
  StreamEvent,
  Usage,
} from "../types.ts";
import type { APIToolSchema } from "../tool.ts";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
  /** Human-readable name (e.g. "anthropic", "openai") */
  readonly name: string;

  /**
   * Stream a completion. Yields incremental events and resolves
   * with the final assembled AssistantMessage.
   */
  stream(params: StreamParams): AsyncGenerator<StreamEvent, AssistantMessage>;
}

export interface StreamParams {
  messages: Message[];
  systemPrompt: string;
  tools: APIToolSchema[];
  model: string;
  maxTokens?: number;
  signal?: AbortSignal;
  thinking?: ThinkingConfig;
}

export interface ThinkingConfig {
  type: "enabled";
  budgetTokens: number;
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  provider: "anthropic" | "openai" | "google";
  apiKey: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  thinking?: ThinkingConfig;
}
