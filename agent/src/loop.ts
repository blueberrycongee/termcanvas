/**
 * Core agent loop — async generator that drives the LLM ↔ tool cycle.
 *
 * Pattern from CC's query.ts, stripped to essentials:
 *  1. Call LLM with messages + tools
 *  2. Collect response (stream events yielded to caller)
 *  3. If response contains tool_use → execute tools → append results → loop
 *  4. If no tool_use (end_turn) → exit
 */

import type { LLMProvider } from "./provider/types.ts";
import type { ToolRegistry } from "./tool.ts";
import { executeTools } from "./tool.ts";
import type {
  AgentOptions,
  AssistantMessage,
  ContentBlock,
  LoopResult,
  Message,
  StreamEvent,
  ToolResultBlock,
  ToolUseBlock,
  Usage,
} from "./types.ts";
import { emptyUsage, mergeUsage } from "./types.ts";

// ---------------------------------------------------------------------------
// Agent loop event — superset of stream events + loop-level events
// ---------------------------------------------------------------------------

export type AgentEvent =
  | StreamEvent
  | { type: "turn_start"; turn: number }
  | { type: "turn_end"; turn: number }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; name: string; content: string; is_error?: boolean }
  | { type: "loop_end"; result: LoopResult };

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function* agentLoop(
  provider: LLMProvider,
  tools: ToolRegistry,
  initialMessages: Message[],
  options: AgentOptions,
): AsyncGenerator<AgentEvent, LoopResult> {
  const maxTurns = options.maxTurns ?? 50;
  const messages: Message[] = [...initialMessages];
  const toolSchemas = tools.toAPISchemas();
  let totalUsage: Usage = emptyUsage();
  let turnCount = 0;

  while (turnCount < maxTurns) {
    if (options.signal?.aborted) {
      const result: LoopResult = {
        reason: "aborted",
        messages,
        totalUsage,
        turnCount,
      };
      yield { type: "loop_end", result };
      return result;
    }

    turnCount++;
    yield { type: "turn_start", turn: turnCount };

    // ----- Stream LLM response -----
    let assistantMessage: AssistantMessage;
    try {
      const stream = provider.stream({
        messages,
        systemPrompt: options.systemPrompt,
        tools: toolSchemas,
        model: "", // model is set in provider config
        signal: options.signal,
      });

      // Forward stream events to caller, collect final message
      let streamResult = await stream.next();
      while (!streamResult.done) {
        yield streamResult.value;
        streamResult = await stream.next();
      }
      assistantMessage = streamResult.value;
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      };
      const result: LoopResult = {
        reason: "error",
        messages,
        totalUsage,
        turnCount,
      };
      yield { type: "loop_end", result };
      return result;
    }

    // Track usage
    if (assistantMessage.usage) {
      totalUsage = mergeUsage(totalUsage, assistantMessage.usage);
    }

    // Append assistant message
    messages.push(assistantMessage);

    // ----- Check for tool use -----
    const toolUseBlocks = assistantMessage.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      // No tools → done
      yield { type: "turn_end", turn: turnCount };
      const result: LoopResult = {
        reason: "completed",
        messages,
        totalUsage,
        turnCount,
      };
      yield { type: "loop_end", result };
      return result;
    }

    // ----- Execute tools -----
    const calls = toolUseBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input,
    }));

    // Yield tool_start events before execution
    for (const call of calls) {
      yield { type: "tool_start" as const, name: call.name, input: call.input };
    }

    const toolResults = await executeTools(
      calls,
      tools,
      options.signal,
      (name, input) => {
        options.onToolStart?.(name, input);
      },
      (name, result) => {
        options.onToolEnd?.(name, result);
      },
    );

    // Yield tool_end events after execution
    for (const tr of toolResults) {
      const call = calls.find((c) => c.id === tr.tool_use_id);
      if (call) {
        yield {
          type: "tool_end",
          name: call.name,
          content: tr.content,
          is_error: tr.is_error,
        };
      }
    }

    // Append tool results as user message
    const resultBlocks: ToolResultBlock[] = toolResults.map((tr) => ({
      type: "tool_result" as const,
      tool_use_id: tr.tool_use_id,
      content: tr.content,
      ...(tr.is_error ? { is_error: true } : {}),
    }));

    messages.push({ role: "user", content: resultBlocks });

    yield { type: "turn_end", turn: turnCount };
  }

  // Max turns reached
  const result: LoopResult = {
    reason: "max_turns",
    messages,
    totalUsage,
    turnCount,
  };
  yield { type: "loop_end", result };
  return result;
}
