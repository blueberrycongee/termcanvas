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
import type { ToolRegistry, PendingTask } from "./tool.ts";
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
import { shouldCompact, compactMessages, initialCompactionState } from "./compaction.ts";
import { getContextWindow } from "./model-registry.ts";

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
  | { type: "compaction"; beforeTokens: number; afterTokens: number }
  | { type: "task_pending"; taskId: string; toolName: string }
  | { type: "task_completed"; taskId: string; toolName: string; result: import("./types.ts").ToolResult }
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
  let compactionState = initialCompactionState();
  const contextWindow = getContextWindow(options.modelId ?? "");
  const pendingTasks = new Map<string, PendingTask>();

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

    // ----- Collect completed background tasks -----
    for (const [taskId, task] of pendingTasks) {
      try {
        // Non-blocking check: use Promise.race with an instant resolver
        const result = await Promise.race([
          task.promise.then((r) => ({ resolved: true as const, result: r })),
          Promise.resolve({ resolved: false as const }),
        ]);
        if (result.resolved) {
          pendingTasks.delete(taskId);
          yield { type: "task_completed", taskId, toolName: task.toolName, result: result.result };
          messages.push({
            role: "system",
            content: `<worker-notification taskId="${taskId}" tool="${task.toolName}">${result.result.content}</worker-notification>`,
            metadata: { taskId, type: "task_completion" },
          });
        }
      } catch {
        pendingTasks.delete(taskId);
      }
    }

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

        // Emergency compaction on prompt_too_long
        if (category === "prompt_too_long" && !compactionState.disabled) {
          const compactionResult = await compactMessages(
            provider, messages, options.systemPrompt, compactionState, options.signal,
          );
          if (compactionResult && compactionResult.compactedMessages !== messages) {
            compactionState = compactionResult.state;
            messages.length = 0;
            messages.push(...compactionResult.compactedMessages);
            yield { type: "compaction", beforeTokens: totalUsage.input_tokens, afterTokens: totalUsage.input_tokens };
            continue;
          }
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

    // ----- Auto-compaction check -----
    if (assistantMessage.usage && shouldCompact(totalUsage.input_tokens, contextWindow, compactionState)) {
      const beforeTokens = totalUsage.input_tokens;
      const compactionResult = await compactMessages(
        provider, messages, options.systemPrompt, compactionState, options.signal,
      );
      if (compactionResult) {
        compactionState = compactionResult.state;
        if (compactionResult.compactedMessages !== messages) {
          messages.length = 0;
          messages.push(...compactionResult.compactedMessages);
          yield { type: "compaction", beforeTokens, afterTokens: beforeTokens };
        }
      }
    }

    // ----- Check for tool use -----
    const toolUseBlocks = assistantMessage.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      if (pendingTasks.size === 0) {
        // Truly done — no pending background work
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

      // Has pending tasks — wait for at least one to complete
      const entries = [...pendingTasks.values()];
      const nextCompleted = await Promise.race(
        entries.map((t) => t.promise.then((r) => ({ taskId: t.taskId, toolName: t.toolName, result: r }))),
      );
      pendingTasks.delete(nextCompleted.taskId);
      yield { type: "task_completed", taskId: nextCompleted.taskId, toolName: nextCompleted.toolName, result: nextCompleted.result };
      messages.push({
        role: "system",
        content: `<worker-notification taskId="${nextCompleted.taskId}" tool="${nextCompleted.toolName}">${nextCompleted.result.content}</worker-notification>`,
        metadata: { taskId: nextCompleted.taskId, type: "task_completion" },
      });

      yield { type: "turn_end", turn: turnCount };
      continue;
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

    const prevPendingSize = pendingTasks.size;
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
      pendingTasks,
    );

    // Emit task_pending events for newly registered background tasks
    if (pendingTasks.size > prevPendingSize) {
      for (const [taskId, task] of pendingTasks) {
        if (task.startTime >= Date.now() - 1000) {
          yield { type: "task_pending", taskId, toolName: task.toolName };
        }
      }
    }

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
