/**
 * Auto-compaction — summarize older messages when context fills up.
 *
 * Multi-threshold: calculates effective context remaining, triggers
 * when below buffer, preserves recent turns verbatim, circuit-breaks
 * after consecutive failures.
 */

import type { LLMProvider } from "./provider/types.ts";
import type { Message } from "./types.ts";
import { isSystemReminder } from "./context-injection.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPACTION_BUFFER_TOKENS = 20_000;
const PRESERVE_RECENT_TURNS = 4;
const MAX_CONSECUTIVE_FAILURES = 3;
const COMPACTION_MAX_TOKENS = 4_096;

// ---------------------------------------------------------------------------
// State (JSON-serializable)
// ---------------------------------------------------------------------------

export interface CompactionState {
  consecutiveFailures: number;
  lastCompactionTurn: number;
  disabled: boolean;
}

export function initialCompactionState(): CompactionState {
  return { consecutiveFailures: 0, lastCompactionTurn: 0, disabled: false };
}

// ---------------------------------------------------------------------------
// Threshold check
// ---------------------------------------------------------------------------

export function shouldCompact(
  currentTokens: number,
  contextWindow: number,
  state: CompactionState,
): boolean {
  if (state.disabled) return false;
  return currentTokens > contextWindow - COMPACTION_BUFFER_TOKENS;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

interface CompactionSplit {
  messagesToSummarize: Message[];
  recentMessages: Message[];
  prompt: string;
}

function splitMessages(messages: Message[], preserveRecent: number): CompactionSplit {
  const turnBoundaries: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "assistant") {
      turnBoundaries.push(i);
    }
  }

  const keepFrom = turnBoundaries.length > preserveRecent
    ? turnBoundaries[turnBoundaries.length - preserveRecent]
    : 0;

  const messagesToSummarize = messages.slice(0, keepFrom).filter((m) => !isSystemReminder(m));
  const recentMessages = messages.slice(keepFrom);

  const conversationText = messagesToSummarize.map((msg) => {
    if (msg.role === "system") {
      return `SYSTEM: ${msg.content.slice(0, 200)}`;
    }
    if (msg.role === "user") {
      const content = typeof msg.content === "string"
        ? msg.content
        : msg.content.map((b) => {
          if (b.type === "text") return b.text;
          if (b.type === "tool_result") return `[tool_result ${b.tool_use_id}]: ${b.content.slice(0, 200)}`;
          return "";
        }).join("\n");
      return `USER: ${content}`;
    }
    const content = msg.content.map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "tool_use") return `[tool_use ${b.name}(${JSON.stringify(b.input).slice(0, 100)})]`;
      if (b.type === "thinking") return `[thinking: ${b.thinking.slice(0, 100)}...]`;
      return "";
    }).join("\n");
    return `ASSISTANT: ${content}`;
  }).join("\n\n");

  const prompt = `Summarize the following conversation history concisely. Preserve:
- Active worker/terminal IDs and their current states
- Pending task states and their progress
- File paths and key code references that are still relevant
- Key decisions made and their rationale
- Current plan state and next steps

Do NOT include:
- Verbose tool outputs that have been processed
- Redundant or superseded information
- Full code blocks (just reference file:line)

Conversation to summarize:
${conversationText}

Write a concise summary that captures the essential state:`;

  return { messagesToSummarize, recentMessages, prompt };
}

// ---------------------------------------------------------------------------
// Compaction execution
// ---------------------------------------------------------------------------

export async function compactMessages(
  provider: LLMProvider,
  messages: Message[],
  systemPrompt: string,
  state: CompactionState,
  signal?: AbortSignal,
): Promise<{ compactedMessages: Message[]; state: CompactionState } | undefined> {
  if (messages.length < PRESERVE_RECENT_TURNS * 2) {
    return undefined;
  }

  const { messagesToSummarize, recentMessages, prompt } = splitMessages(messages, PRESERVE_RECENT_TURNS);

  if (messagesToSummarize.length === 0) {
    return undefined;
  }

  try {
    const stream = provider.stream({
      messages: [{ role: "user", content: prompt }],
      systemPrompt: "You are a conversation summarizer. Be concise and preserve all actionable state.",
      tools: [],
      model: "",
      maxTokens: COMPACTION_MAX_TOKENS,
      signal,
    });

    let result = await stream.next();
    while (!result.done) {
      result = await stream.next();
    }

    const assistantMsg = result.value;
    const summaryText = assistantMsg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    if (!summaryText) {
      return handleFailure(messages, state);
    }

    const summaryMessage: Message = {
      role: "user",
      content: `<context-summary>\nThe following is a summary of the earlier conversation:\n${summaryText}\n</context-summary>`,
    };

    const compacted = [summaryMessage, ...recentMessages];
    if (compacted.length >= messages.length) {
      return handleFailure(messages, state);
    }

    return {
      compactedMessages: compacted,
      state: {
        consecutiveFailures: 0,
        lastCompactionTurn: state.lastCompactionTurn + 1,
        disabled: false,
      },
    };
  } catch {
    return handleFailure(messages, state);
  }
}

function handleFailure(
  messages: Message[],
  state: CompactionState,
): { compactedMessages: Message[]; state: CompactionState } | undefined {
  const failures = state.consecutiveFailures + 1;
  const disabled = failures >= MAX_CONSECUTIVE_FAILURES;

  return {
    compactedMessages: messages,
    state: {
      consecutiveFailures: failures,
      lastCompactionTurn: state.lastCompactionTurn,
      disabled,
    },
  };
}
