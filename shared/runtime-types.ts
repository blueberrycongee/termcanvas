export type TerminalType =
  | "shell"
  | "claude"
  | "codex"
  | "kimi"
  | "gemini"
  | "opencode"
  | "lazygit"
  | "tmux";

export type TerminalStatus =
  | "running"
  | "active"
  | "waiting"
  | "completed"
  | "success"
  | "error"
  | "idle";

export type TerminalOrigin = "user" | "agent";

export interface TerminalData {
  id: string;
  title: string;
  customTitle?: string;
  starred?: boolean;
  type: TerminalType;
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
  status: TerminalStatus;
  span: { cols: number; rows: number };
  origin?: TerminalOrigin;
  parentTerminalId?: string;
  scrollback?: string;
  sessionId?: string;
  initialPrompt?: string;
  autoApprove?: boolean;
  stashed?: boolean;
  stashedAt?: number;
}

export interface StashedTerminal {
  terminal: TerminalData;
  projectId: string;
  worktreeId: string;
  stashedAt: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface WorktreeData {
  id: string;
  name: string;
  path: string;
  position: Position;
  collapsed: boolean;
  terminals: TerminalData[];
}

export interface ProjectData {
  id: string;
  name: string;
  path: string;
  position: Position;
  collapsed: boolean;
  zIndex: number;
  autoCompact?: boolean;
  worktrees: WorktreeData[];
}
