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
