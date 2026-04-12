import type {
  PersistedTerminalData,
  TerminalData,
  TerminalType,
} from "../types/index.ts";

export const DEFAULT_SPAN: Record<TerminalType, { cols: number; rows: number }> = {
  shell: { cols: 1, rows: 1 },
  claude: { cols: 1, rows: 1 },
  codex: { cols: 1, rows: 1 },
  kimi: { cols: 1, rows: 1 },
  gemini: { cols: 1, rows: 1 },
  opencode: { cols: 1, rows: 1 },
  wuu: { cols: 1, rows: 1 },
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

export function getTerminalDisplayTitle(terminal: TerminalData): string {
  return terminal.customTitle
    ? `${terminal.customTitle} · ${terminal.title}`
    : terminal.title;
}

export function getTerminalHeaderContextLabel(
  worktreeName: string | undefined,
  terminalTitle: string,
): string {
  const normalizedWorktreeName = worktreeName?.trim();
  return normalizedWorktreeName && normalizedWorktreeName.length > 0
    ? normalizedWorktreeName
    : terminalTitle;
}

export function stripTerminalRuntimeState(
  terminal: TerminalData,
  overrides?: Partial<Pick<PersistedTerminalData, "scrollback">>,
): PersistedTerminalData {
  const { ptyId: _ptyId, status: _status, ...persisted } = terminal;
  return {
    ...persisted,
    ...overrides,
  };
}

export function restorePersistedTerminal(
  terminal: PersistedTerminalData | (PersistedTerminalData & {
    ptyId?: number | null;
    status?: TerminalData["status"];
  }),
): TerminalData {
  const status =
    "status" in terminal && terminal.status !== undefined
      ? terminal.status
      : "idle";

  return {
    ...terminal,
    ptyId: null,
    status,
  };
}
