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
import { getContextWindow, getMaxOutputTokens } from "./model-registry.ts";
import { buildFullSystemPrompt, buildSystemReminder, isSystemReminder } from "./context-injection.ts";
import { SessionWriter, resumeSession, generateSessionId } from "./session.ts";

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
  | { type: "max_tokens_recovery"; attempt: number; maxTokens: number }
  | { type: "fallback_model_switch"; from: string; to: string }
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
  let messages: Message[] = [...initialMessages];
  const toolSchemas = tools.toAPISchemas();
  let totalUsage: Usage = emptyUsage();
  let turnCount = 0;
  let costTracker = new CostTracker(options.modelId ?? "");
  let compactionState = initialCompactionState();
  const contextWindow = getContextWindow(options.modelId ?? "");
  const pendingTasks = new Map<string, PendingTask>();
  let maxTokensRecoveryCount = 0;
  let currentMaxTokens: number | undefined;
  let currentModel = options.modelId ?? "";

  // Session: resume or initialize
  let sessionWriter: SessionWriter | undefined;
  if (options.session) {
    const sessionId = options.session.sessionId ?? generateSessionId();

    if (options.session.resumeFromId) {
      const resumed = await resumeSession(options.session.resumeFromId, options.session.persistDir);
      if (resumed.messages.length > 0) {
        messages = resumed.messages;
      }
      if (resumed.costState) {
        costTracker = new CostTracker(options.modelId ?? "", resumed.costState);
      }
      compactionState = resumed.compactionState;
    }

    sessionWriter = new SessionWriter(sessionId, options.session.persistDir);
  }

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
      if (task.settled) {
        const result = task.settledResult ?? { content: "" };
        pendingTasks.delete(taskId);
        yield { type: "task_completed", taskId, toolName: task.toolName, result };
        messages.push({
          role: "system",
          content: `<worker-notification taskId="${taskId}" tool="${task.toolName}">${result.content}</worker-notification>`,
          metadata: { taskId, type: "task_completion" },
        });
      }
    }

    // ----- Resolve system prompt and ephemeral context -----
    const resolvedSystemPrompt = options.systemPromptConfig
      ? buildFullSystemPrompt(options.systemPromptConfig)
      : options.systemPrompt;

    if (options.ephemeralContext) {
      const idx = messages.findIndex(isSystemReminder);
      if (idx !== -1) messages.splice(idx, 1);

      const ctx = typeof options.ephemeralContext === "function"
        ? options.ephemeralContext()
        : options.ephemeralContext;
      messages.unshift(buildSystemReminder(ctx));
    }

    // ----- Stream LLM response with error-category retry -----
    let assistantMessage: AssistantMessage | undefined;
    let retryCount = 0;

    while (assistantMessage === undefined) {
      try {
        const stream = provider.stream({
          messages,
          systemPrompt: resolvedSystemPrompt,
          tools: toolSchemas,
          model: "",
          signal: options.signal,
          ...(currentMaxTokens !== undefined ? { maxTokens: currentMaxTokens } : {}),
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
            // WIP: afterTokens equals beforeTokens — actual post-compaction count
            // is unknown until the next API call. Consumers reading this event
            // get misleading data. Either drop afterTokens or estimate from the
            // compacted message lengths.
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
      const costState = costTracker.getState();
      yield { type: "cost_update", costState };
      sessionWriter?.appendCostSnapshot(costState);
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
    sessionWriter?.appendMessage(assistantMessage);

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
          sessionWriter?.appendCompactionMarker(turnCount);
        }
      }
    }

    // ----- Check for tool use -----
    const toolUseBlocks = assistantMessage.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
      // max_tokens recovery: output was truncated, not a clean end_turn
      if (assistantMessage.stop_reason === "max_tokens") {
        const MAX_RECOVERY_ATTEMPTS = 3;
        const OUTPUT_REDUCTION_FACTOR = 0.8;

        if (maxTokensRecoveryCount < MAX_RECOVERY_ATTEMPTS) {
          maxTokensRecoveryCount++;
          const baseTokens = currentMaxTokens ?? getMaxOutputTokens(currentModel);
          currentMaxTokens = Math.floor(baseTokens * OUTPUT_REDUCTION_FACTOR);
          yield { type: "max_tokens_recovery", attempt: maxTokensRecoveryCount, maxTokens: currentMaxTokens };
          messages.push({
            role: "user",
            content: "Output token limit hit. Resume directly from where you stopped — no preamble, no recap.",
          });
          yield { type: "turn_end", turn: turnCount };
          continue;
        }

        if (options.fallbackModel) {
          const previousModel = currentModel;
          currentModel = options.fallbackModel;
          currentMaxTokens = undefined;
          maxTokensRecoveryCount = 0;
          yield { type: "fallback_model_switch", from: previousModel, to: currentModel };
          messages.push({
            role: "user",
            content: "Output token limit hit. Resume directly from where you stopped — no preamble, no recap.",
          });
          yield { type: "turn_end", turn: turnCount };
          continue;
        }
      }

      if (pendingTasks.size === 0) {
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
      options.hooks,
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

    const toolResultMessage = { role: "user" as const, content: resultBlocks };
    messages.push(toolResultMessage);
    sessionWriter?.appendMessage(toolResultMessage);

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
