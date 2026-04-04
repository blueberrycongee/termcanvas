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

export interface LLMProvider {
  readonly name: string;

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
  reasoningEffort?: "low" | "medium" | "high";
}

export interface ThinkingConfig {
  type: "enabled";
  budgetTokens: number;
}

export interface ProviderConfig {
  provider: "anthropic" | "openai" | "google";
  apiKey: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  thinking?: ThinkingConfig;
}
