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
import { categorizeError, isRetryableCategory, getRetryDelay, parseTokenLimits } from "./errors.ts";
import { CostTracker } from "./cost-tracker.ts";
import { shouldCompact, compactMessages, initialCompactionState } from "./compaction.ts";
import { getContextWindow, getMaxOutputTokens } from "./model-registry.ts";
import { buildFullSystemPrompt, buildSystemReminder, isSystemReminder } from "./context-injection.ts";
import { SessionWriter, resumeSession, generateSessionId } from "./session.ts";
import { evaluateApproval } from "./approval-bridge.ts";
import type { WorkerStatus } from "./worker-state.ts";

// Agent loop event — superset of stream events + loop-level events

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
  | { type: "approval_auto"; terminalId: string; toolName: string; action: "approve" | "reject" }
  | { type: "approval_escalated"; terminalId: string; toolName: string }
  | { type: "worker_state_change"; terminalId: string; from: WorkerStatus; to: WorkerStatus }
  | { type: "worker_active_warning"; activeCount: number }
  | { type: "tool_progress"; toolCallId: string; toolName: string; data: unknown; timestamp: number }
  | { type: "loop_end"; result: LoopResult };

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
  let contextWindow = getContextWindow(options.modelId ?? "");
  const pendingTasks = new Map<string, PendingTask>();
  let maxTokensRecoveryCount = 0;
  let currentMaxTokens: number | undefined;
  let currentModel = options.modelId ?? "";

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

    if (options.workerTracker && options.telemetryCheckFn) {
      const changes = await options.workerTracker.checkAll(options.telemetryCheckFn);
      for (const change of changes) {
        yield { type: "worker_state_change", terminalId: change.terminalId, from: change.from, to: change.to };
        messages.push({
          role: "system",
          content: `<worker-state terminalId="${change.terminalId}">Status changed: ${change.from} → ${change.to}</worker-state>`,
          metadata: { type: "worker_state" },
        });
      }
    }

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

    if (options.approvalBridge) {
      const bridge = options.approvalBridge;
      const approvals = await bridge.detectPendingApprovals();
      for (const pending of approvals) {
        const decision = evaluateApproval(pending, bridge.policy);
        if (decision !== "escalate") {
          try {
            await bridge.deliverDecision(pending.terminalId, decision);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            messages.push({
              role: "system",
              content: `<approval-warning terminalId="${pending.terminalId}" tool="${pending.toolName}">Failed to deliver approval: ${msg}</approval-warning>`,
              metadata: { type: "approval" },
            });
            continue;
          }
          yield { type: "approval_auto", terminalId: pending.terminalId, toolName: pending.toolName, action: decision.action };
          messages.push({
            role: "system",
            content: `<approval-notification terminalId="${pending.terminalId}" tool="${pending.toolName}">${decision.reason}</approval-notification>`,
            metadata: { type: "approval" },
          });
        } else {
          yield { type: "approval_escalated", terminalId: pending.terminalId, toolName: pending.toolName };
          messages.push({
            role: "system",
            content: `<approval-request terminalId="${pending.terminalId}" tool="${pending.toolName}">Worker needs permission for ${pending.toolName}. This is not a read-only operation. Ask the user whether to approve or reject.</approval-request>`,
            metadata: { type: "approval" },
          });
        }
      }
    }

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

    let assistantMessage: AssistantMessage | undefined;
    let retryCount = 0;

    while (assistantMessage === undefined) {
      try {
        const stream = provider.stream({
          messages,
          systemPrompt: resolvedSystemPrompt,
          tools: toolSchemas,
          model: currentModel,
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

        if (category === "prompt_too_long" && !compactionState.disabled) {
          const tokenLimits = parseTokenLimits(err);
          const beforeTokens = totalUsage.input_tokens;
          const compactionResult = await compactMessages(
            provider, messages, options.systemPrompt, compactionState, options.signal,
          );
          if (compactionResult && compactionResult.compactedMessages !== messages) {
            compactionState = compactionResult.state;
            const ratio = compactionResult.compactedMessages.length / Math.max(messages.length, 1);
            messages.length = 0;
            messages.push(...compactionResult.compactedMessages);
            const afterTokens = tokenLimits?.limit
              ? Math.floor(tokenLimits.limit * 0.7)
              : Math.floor(beforeTokens * ratio);
            yield { type: "compaction", beforeTokens, afterTokens };
            retryCount = 0;
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

    if (assistantMessage.usage) {
      totalUsage = mergeUsage(totalUsage, assistantMessage.usage);
      costTracker.addUsage(assistantMessage.usage, currentModel);
      const costState = costTracker.getState();
      yield { type: "cost_update", costState };
      sessionWriter?.appendCostSnapshot(costState);
    }

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

    messages.push(assistantMessage);
    sessionWriter?.appendMessage(assistantMessage);

    if (assistantMessage.usage && shouldCompact(totalUsage.input_tokens, contextWindow, compactionState)) {
      const beforeTokens = totalUsage.input_tokens;
      const compactionResult = await compactMessages(
        provider, messages, options.systemPrompt, compactionState, options.signal,
      );
      if (compactionResult) {
        compactionState = compactionResult.state;
        if (compactionResult.compactedMessages !== messages) {
          const ratio = compactionResult.compactedMessages.length / Math.max(messages.length, 1);
          messages.length = 0;
          messages.push(...compactionResult.compactedMessages);
          yield { type: "compaction", beforeTokens, afterTokens: Math.floor(beforeTokens * ratio) };
          sessionWriter?.appendCompactionMarker(turnCount);
        }
      }
    }

    const toolUseBlocks = assistantMessage.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0) {
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
          contextWindow = getContextWindow(currentModel);
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
        const activeWorkers = options.workerTracker?.activeCount() ?? 0;
        if (activeWorkers > 0) {
          yield { type: "worker_active_warning", activeCount: activeWorkers };
          messages.push({
            role: "system",
            content: `<worker-warning>${activeWorkers} worker(s) still active. Exiting may lose their results.</worker-warning>`,
            metadata: { type: "worker_state" },
          });
        }

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

    const calls = toolUseBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input,
    }));

    for (const call of calls) {
      yield { type: "tool_start" as const, name: call.name, input: call.input };
    }

    const prevPendingSize = pendingTasks.size;
    const progressEvents: AgentEvent[] = [];
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
      (toolCallId, toolName) => (data) => {
        progressEvents.push({ type: "tool_progress", toolCallId, toolName, data, timestamp: Date.now() });
      },
    );

    for (const evt of progressEvents) {
      yield evt;
    }

    if (pendingTasks.size > prevPendingSize) {
      for (const [taskId, task] of pendingTasks) {
        if (task.startTime >= Date.now() - 1000) {
          yield { type: "task_pending", taskId, toolName: task.toolName };
        }
      }
    }

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
