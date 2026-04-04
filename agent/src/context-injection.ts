/**
 * Context injection — static/dynamic prompt splitting and system-reminder messages.
 *
 * Static portions of the system prompt are cacheable; dynamic portions
 * are refreshed each turn. Ephemeral context is injected as a tagged
 * user message that compaction knows to replace rather than preserve.
 */

import type { UserMessage, Message } from "./types.ts";

export interface SystemPromptConfig {
  staticPrompt: string;
  dynamicPrompt?: () => string;
}

export type EphemeralContext = Record<string, string>;

const DYNAMIC_BOUNDARY = "<!-- dynamic-boundary -->";

export function buildFullSystemPrompt(config: SystemPromptConfig): string {
  if (!config.dynamicPrompt) return config.staticPrompt;
  return `${config.staticPrompt}\n${DYNAMIC_BOUNDARY}\n${config.dynamicPrompt()}`;
}

export function buildSystemReminder(context: EphemeralContext): UserMessage {
  const sections = Object.entries(context)
    .map(([key, value]) => `# ${key}\n${value}`)
    .join("\n");

  return {
    role: "user",
    content: `<system-reminder>\n${sections}\n</system-reminder>`,
  };
}

export function isSystemReminder(msg: Message): boolean {
  if (msg.role !== "user") return false;
  if (typeof msg.content !== "string") return false;
  return msg.content.startsWith("<system-reminder>");
}

export function stripSystemReminders(messages: Message[]): Message[] {
  return messages.filter((msg) => !isSystemReminder(msg));
}
