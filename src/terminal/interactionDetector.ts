/**
 * Detect known interaction prompts in terminal output text.
 *
 * Claude Code and Codex render specific hardcoded strings when waiting
 * for user approval, answering questions, or reviewing plans.  We match
 * against the tail of the stripped preview text to avoid matching
 * historical output that has already scrolled past.
 */

const TAIL_CHARS = 500;

const CLAUDE_PATTERNS: RegExp[] = [
  /Do you want to proceed\?/,
  /Do you want to make this edit/,
  /Enter plan mode\?/,
  /approve the plan/i,
  /Enter to select/,
  /Would you like to proceed/,
];

const CODEX_PATTERNS: RegExp[] = [
  /Do you want to approve/,
  /Press enter to confirm or esc to cancel/,
];

export function detectInteractionPrompt(
  previewText: string,
  provider: "claude" | "codex" | "unknown",
): boolean {
  if (!previewText) return false;

  const tail =
    previewText.length > TAIL_CHARS
      ? previewText.slice(-TAIL_CHARS)
      : previewText;

  const patterns =
    provider === "codex"
      ? CODEX_PATTERNS
      : provider === "claude"
        ? CLAUDE_PATTERNS
        : [...CLAUDE_PATTERNS, ...CODEX_PATTERNS];

  return patterns.some((pattern) => pattern.test(tail));
}
