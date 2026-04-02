/**
 * OpenAI-compatible provider — works with any endpoint that implements
 * the OpenAI Chat Completions API (OpenAI, DeepSeek, Moonshot, GLM,
 * Minimax, Qwen, Google Gemini OpenAI-compat, etc.).
 *
 * Uses raw fetch instead of the OpenAI SDK to keep dependencies minimal
 * and avoid version coupling. The Chat Completions streaming protocol
 * is simple enough to parse directly.
 */

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

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor(apiKey: string, model: string, baseURL = "https://api.openai.com/v1") {
    this.apiKey = apiKey;
    this.model = model;
    // Normalize: strip trailing slash, ensure no /chat/completions suffix
    this.baseURL = baseURL.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  }

  async *stream(params: StreamParams): AsyncGenerator<StreamEvent, AssistantMessage> {
    const model = params.model || this.model;
    const maxTokens = params.maxTokens ?? 16384;

    const messages = toOpenAIMessages(params.systemPrompt, params.messages);
    const tools = params.tools.length > 0
      ? params.tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }))
      : undefined;

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      stream: true,
      ...(tools ? { tools } : {}),
    };

    const assembled = yield* this.doStream(body, params.signal);
    return assembled;
  }

  private async *doStream(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, AssistantMessage> {
    const url = `${this.baseURL}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw Object.assign(
        new Error(`OpenAI API error ${response.status}: ${text.slice(0, 500)}`),
        { status: response.status },
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    // Accumulate content
    let textContent = "";
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let stopReason: StopReason = null;
    let usage: Usage = { input_tokens: 0, output_tokens: 0 };

    yield { type: "message_start", usage };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          let parsed: OpenAIChunk;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          if (parsed.usage) {
            usage = {
              input_tokens: parsed.usage.prompt_tokens ?? 0,
              output_tokens: parsed.usage.completion_tokens ?? 0,
            };
          }

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            textContent += delta.content;
            yield { type: "text_delta", text: delta.content };
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (tc.id) {
                toolCalls.set(idx, { id: tc.id, name: tc.function?.name ?? "", args: "" });
                yield { type: "tool_use_start", id: tc.id, name: tc.function?.name ?? "" };
              }
              const existing = toolCalls.get(idx);
              if (existing && tc.function?.arguments) {
                existing.args += tc.function.arguments;
                yield { type: "input_json_delta", partial_json: tc.function.arguments };
              }
            }
          }

          // Finish reason
          if (choice.finish_reason) {
            stopReason = mapFinishReason(choice.finish_reason);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: "message_delta", stop_reason: stopReason, usage };

    // Assemble final message
    const content: ContentBlock[] = [];
    if (textContent) {
      content.push({ type: "text", text: textContent });
    }
    for (const [, tc] of [...toolCalls.entries()].sort(([a], [b]) => a - b)) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.args || "{}");
      } catch {
        // malformed
      }
      content.push({ type: "tool_use", id: tc.id, name: tc.name, input });
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

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function toOpenAIMessages(systemPrompt: string, messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === "system") {
      out.push({ role: "system", content: msg.content });
      continue;
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: msg.content });
      } else {
        // Contains tool_result blocks — map to individual tool messages
        const textParts: string[] = [];
        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_result") {
            out.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: block.content,
            });
          }
        }
        if (textParts.length > 0) {
          out.push({ role: "user", content: textParts.join("\n") });
        }
      }
      continue;
    }

    // assistant
    const textParts: string[] = [];
    const toolCallsOut: OpenAIMessage["tool_calls"] = [];

    for (const block of msg.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        toolCallsOut.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    out.push({
      role: "assistant",
      content: textParts.join("\n") || null,
      ...(toolCallsOut.length > 0 ? { tool_calls: toolCallsOut } : {}),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OpenAIChunk {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function mapFinishReason(reason: string): StopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

