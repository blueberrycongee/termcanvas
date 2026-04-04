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

    const assembled = yield* this.doStream(requestParams, params.signal);
    return assembled;
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

    let completed = false;
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
      completed = true;
    } finally {
      if (!completed) stream.controller.abort();
    }

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

function toMessageParams(messages: Message[]): MessageParam[] {
  const out: MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Anthropic API doesn't have system role in messages — inject as user message
      out.push({ role: "user", content: `<system-reminder>${msg.content}</system-reminder>` });
      continue;
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: msg.content });
      } else {
        const blocks: ContentBlockParam[] = msg.content.map((block) => {
          if (block.type === "text") {
            return { type: "text" as const, text: block.text };
          }
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
        out.push({ role: "user", content: blocks });
      }
      continue;
    }

    const blocks: ContentBlockParam[] = msg.content
      .filter((b) => b.type !== "thinking")
      .map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
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
    out.push({ role: "assistant", content: blocks });
  }

  return mergeConsecutiveSameRole(out);
}

function mergeConsecutiveSameRole(messages: MessageParam[]): MessageParam[] {
  if (messages.length <= 1) return messages;

  const merged: MessageParam[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = messages[i];

    if (prev.role === curr.role) {
      const prevBlocks = toContentBlockArray(prev.content);
      const currBlocks = toContentBlockArray(curr.content);
      merged[merged.length - 1] = { role: prev.role, content: [...prevBlocks, ...currBlocks] } as MessageParam;
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

function toContentBlockArray(content: string | ContentBlockParam[]): ContentBlockParam[] {
  if (typeof content === "string") {
    return [{ type: "text" as const, text: content }];
  }
  return content;
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

type PartialBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; inputJson: string }
  | { type: "thinking"; thinking: string };

