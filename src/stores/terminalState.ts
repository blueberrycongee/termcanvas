import type { TerminalData, TerminalType } from "../types";

export const DEFAULT_SPAN: Record<TerminalType, { cols: number; rows: number }> = {
  shell: { cols: 1, rows: 1 },
  claude: { cols: 1, rows: 1 },
  codex: { cols: 1, rows: 1 },
  kimi: { cols: 1, rows: 1 },
  gemini: { cols: 1, rows: 1 },
  opencode: { cols: 1, rows: 1 },
  lazygit: { cols: 1, rows: 1 },
  tmux: { cols: 1, rows: 1 },
};

export function withUpdatedTerminalType(
  terminal: TerminalData,
  type: TerminalType,
): TerminalData {
  return { ...terminal, type };
}

export function normalizeTerminalCustomTitle(
  customTitle: string,
): string | undefined {
  const normalized = customTitle.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : undefined;
}

export function withUpdatedTerminalCustomTitle(
  terminal: TerminalData,
  customTitle: string,
): TerminalData {
  return {
    ...terminal,
    customTitle: normalizeTerminalCustomTitle(customTitle),
  };
}

export function withToggledTerminalStarred(
  terminal: TerminalData,
): TerminalData {
  return {
    ...terminal,
    starred: !terminal.starred,
  };
}

/** Human-readable labels for CLI-backed terminal types. */
const CLI_TYPE_LABELS: Partial<Record<TerminalType, string>> = {
  claude: "Claude",
  codex: "Codex",
  kimi: "Kimi",
  gemini: "Gemini",
  opencode: "OpenCode",
  lazygit: "Lazygit",
  tmux: "Tmux",
};

/**
 * Auto-generate a display title from session context.
 * Priority: CLI tool label > working directory basename > "Terminal".
 */
function autoTitle(terminal: TerminalData, worktreePath?: string): string {
  // Non-shell CLI types get their human-readable label
  const label = CLI_TYPE_LABELS[terminal.type];
  if (label) return label;

  // Shell: use working directory basename when available
  if (worktreePath) {
    const base = worktreePath.split("/").filter(Boolean).pop();
    if (base) return base;
  }

  return "Terminal";
}

export function getTerminalDisplayTitle(
  terminal: TerminalData,
  worktreePath?: string,
): string {
  if (terminal.customTitle) {
    return terminal.customTitle;
  }
  return autoTitle(terminal, worktreePath);
}
