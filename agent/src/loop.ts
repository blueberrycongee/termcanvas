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
import { categorizeError, isRetryableCategory, getRetryDelay } from "./errors.ts";
import { CostTracker } from "./cost-tracker.ts";

// ---------------------------------------------------------------------------
// Agent loop event — superset of stream events + loop-level events
// ---------------------------------------------------------------------------

export type AgentEvent =
  | StreamEvent
  | { type: "turn_start"; turn: number }
  | { type: "turn_end"; turn: number }
  | { type: "tool_start"; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; name: string; content: string; is_error?: boolean }
  | { type: "cost_update"; costState: import("./cost-tracker.ts").CostState }
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
  const maxRetries = 3;
  const messages: Message[] = [...initialMessages];
  const toolSchemas = tools.toAPISchemas();
  let totalUsage: Usage = emptyUsage();
  let turnCount = 0;
  const costTracker = new CostTracker(options.modelId ?? "");

  while (turnCount < maxTurns) {
    if (options.signal?.aborted) {
      const result: LoopResult = {
        reason: "aborted",
        messages,
        totalUsage,
        turnCount,
        costState: costTracker.getState(),
      };
      yield { type: "loop_end", result };
      return result;
    }

    turnCount++;
    yield { type: "turn_start", turn: turnCount };

    // ----- Stream LLM response with error-category retry -----
    let assistantMessage: AssistantMessage | undefined;
    let retryCount = 0;

    while (assistantMessage === undefined) {
      try {
        const stream = provider.stream({
          messages,
          systemPrompt: options.systemPrompt,
          tools: toolSchemas,
          model: "", // model is set in provider config
          signal: options.signal,
        });

        let streamResult = await stream.next();
        while (!streamResult.done) {
          yield streamResult.value;
          streamResult = await stream.next();
        }
        assistantMessage = streamResult.value;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const category = categorizeError(err);

        yield { type: "error", error };

        if (isRetryableCategory(category) && retryCount < maxRetries) {
          retryCount++;
          const delay = getRetryDelay(category, retryCount);
          await sleep(delay, options.signal);
          continue;
        }

        const result: LoopResult = {
          reason: "error",
          messages,
          totalUsage,
          turnCount,
          errorCategory: category,
          costState: costTracker.getState(),
        };
        yield { type: "loop_end", result };
        return result;
      }
    }

    // Track usage and cost
    if (assistantMessage.usage) {
      totalUsage = mergeUsage(totalUsage, assistantMessage.usage);
      costTracker.addUsage(assistantMessage.usage);
      yield { type: "cost_update", costState: costTracker.getState() };
    }

    // Budget check
    if (options.maxBudgetUSD !== undefined && costTracker.exceedsBudget(options.maxBudgetUSD)) {
      messages.push(assistantMessage);
      const result: LoopResult = {
        reason: "budget_exceeded",
        messages,
        totalUsage,
        turnCount,
        costState: costTracker.getState(),
      };
      yield { type: "loop_end", result };
      return result;
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
        costState: costTracker.getState(),
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
    costState: costTracker.getState(),
  };
  yield { type: "loop_end", result };
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
