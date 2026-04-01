/**
 * Anthropic BYOK provider — calls Claude API directly with user's API key.
 *
 * Handles streaming, tool_use, thinking blocks, and retry with
 * exponential backoff.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlockParam,
  ToolResultBlockParam,
  MessageStreamEvent,
  ToolUseBlock as APIToolUseBlock,
  MessageCreateParamsBase,
} from "@anthropic-ai/sdk/resources/messages.js";

import type { LLMProvider, StreamParams } from "./types.ts";
import type {
  AssistantMessage,
  ContentBlock,
  Message,
  StreamEvent,
  StopReason,
  Usage,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string, baseURL?: string) {
    this.model = model;
    this.client = new Anthropic({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      maxRetries: 0, // we handle retries ourselves
    });
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent, AssistantMessage> {
    const messages = toMessageParams(params.messages);
    const maxTokens = params.maxTokens ?? 16384;
    const model = params.model || this.model;

    const requestParams: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: params.systemPrompt,
      messages,
      stream: true,
      ...(params.tools.length > 0
        ? { tools: params.tools.map(toAnthropicTool) }
        : {}),
      ...(params.thinking
        ? {
            thinking: {
              type: "enabled",
              budget_tokens: params.thinking.budgetTokens,
            },
          }
        : {}),
    };

    const assembled = yield* this.streamWithRetry(requestParams, params.signal);
    return assembled;
  }

  private async *streamWithRetry(
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, AssistantMessage> {
    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      if (attempt > 0) {
        const delay = Math.min(500 * 2 ** (attempt - 1), 16_000);
        const jitter = delay * (0.75 + Math.random() * 0.5);
        await sleep(jitter, signal);
      }

      try {
        return yield* this.doStream(params, signal);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (!isRetryable(err) || attempt === maxRetries) {
          throw lastError;
        }

        yield { type: "error", error: lastError };
      }
    }

    throw lastError ?? new Error("Stream failed");
  }

  private async *doStream(
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, AssistantMessage> {
    const stream = this.client.messages.stream(
      params as unknown as Parameters<typeof this.client.messages.stream>[0],
      { signal },
    );

    const contentBlocks: Map<number, PartialBlock> = new Map();
    let stopReason: StopReason = null;
    let usage: Usage = { input_tokens: 0, output_tokens: 0 };

    try {
      for await (const event of stream) {
        const streamEvent = event as MessageStreamEvent;

        switch (streamEvent.type) {
          case "message_start": {
            const msg = streamEvent.message;
            const rawUsage = msg.usage as unknown as Record<string, number> | undefined;
            usage = {
              input_tokens: rawUsage?.input_tokens ?? 0,
              output_tokens: rawUsage?.output_tokens ?? 0,
              cache_creation_input_tokens: rawUsage?.cache_creation_input_tokens,
              cache_read_input_tokens: rawUsage?.cache_read_input_tokens,
            };
            yield { type: "message_start", usage };
            break;
          }

          case "content_block_start": {
            const idx = streamEvent.index;
            const block = streamEvent.content_block;

            if (block.type === "text") {
              contentBlocks.set(idx, { type: "text", text: "" });
            } else if (block.type === "tool_use") {
              contentBlocks.set(idx, {
                type: "tool_use",
                id: (block as APIToolUseBlock).id,
                name: (block as APIToolUseBlock).name,
                inputJson: "",
              });
              yield {
                type: "tool_use_start",
                id: (block as APIToolUseBlock).id,
                name: (block as APIToolUseBlock).name,
              };
            } else if (block.type === "thinking") {
              contentBlocks.set(idx, { type: "thinking", thinking: "" });
            }
            break;
          }

          case "content_block_delta": {
            const idx = streamEvent.index;
            const partial = contentBlocks.get(idx);
            const delta = streamEvent.delta as unknown as Record<string, string>;

            if (!partial) break;

            if (partial.type === "text" && delta.type === "text_delta") {
              partial.text += delta.text ?? "";
              yield { type: "text_delta", text: delta.text ?? "" };
            } else if (
              partial.type === "tool_use" &&
              delta.type === "input_json_delta"
            ) {
              partial.inputJson += delta.partial_json ?? "";
              yield {
                type: "input_json_delta",
                partial_json: delta.partial_json ?? "",
              };
            } else if (
              partial.type === "thinking" &&
              delta.type === "thinking_delta"
            ) {
              partial.thinking += delta.thinking ?? "";
              yield {
                type: "thinking_delta",
                thinking: delta.thinking ?? "",
              };
            }
            break;
          }

          case "content_block_stop": {
            yield { type: "content_block_stop", index: streamEvent.index };
            break;
          }

          case "message_delta": {
            const d = streamEvent.delta as unknown as Record<string, unknown>;
            stopReason = (d.stop_reason as StopReason) ?? null;
            const deltaUsage = streamEvent.usage as
              | { output_tokens?: number }
              | undefined;
            if (deltaUsage?.output_tokens) {
              usage.output_tokens = deltaUsage.output_tokens;
            }
            yield { type: "message_delta", stop_reason: stopReason, usage };
            break;
          }
        }
      }
    } finally {
      stream.controller.abort();
    }

    // Assemble final message
    const content: ContentBlock[] = [];
    for (const [, block] of [...contentBlocks.entries()].sort(
      ([a], [b]) => a - b,
    )) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(block.inputJson || "{}");
        } catch {
          // malformed JSON — keep empty
        }
        content.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input,
        });
      } else if (block.type === "thinking") {
        content.push({ type: "thinking", thinking: block.thinking });
      }
    }

    return {
      role: "assistant" as const,
      content,
      stop_reason: stopReason,
      usage,
    };
  }
}

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

function toMessageParams(messages: Message[]): MessageParam[] {
  return messages.map((msg): MessageParam => {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return { role: "user", content: msg.content };
      }
      const blocks: ContentBlockParam[] = msg.content.map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        // tool_result
        const tr = block as {
          tool_use_id: string;
          content: string;
          is_error?: boolean;
        };
        return {
          type: "tool_result" as const,
          tool_use_id: tr.tool_use_id,
          content: tr.content,
          ...(tr.is_error ? { is_error: true } : {}),
        } as ToolResultBlockParam;
      });
      return { role: "user", content: blocks };
    }

    // assistant
    const blocks: ContentBlockParam[] = msg.content
      .filter((b) => b.type !== "thinking")
      .map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        // tool_use
        const tu = block as {
          id: string;
          name: string;
          input: Record<string, unknown>;
        };
        return {
          type: "tool_use" as const,
          id: tu.id,
          name: tu.name,
          input: tu.input,
        };
      });
    return { role: "assistant", content: blocks };
  });
}

function toAnthropicTool(schema: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}) {
  return {
    name: schema.name,
    description: schema.description,
    input_schema: schema.input_schema,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PartialBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; inputJson: string }
  | { type: "thinking"; thinking: string };

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes("abort")) return false;
  // Retry on network errors and 5xx / 429
  if (msg.includes("connection") || msg.includes("timeout")) return true;
  const status = (err as { status?: number }).status;
  if (status && (status >= 500 || status === 429 || status === 408 || status === 409)) {
    return true;
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    }, { once: true });
  });
}
