export type TerminalType =
  | "shell"
  | "claude"
  | "codex"
  | "kimi"
  | "gemini"
  | "opencode"
  | "lazygit"
  | "tmux";

export interface Position {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export type TerminalStatus =
  | "running"
  | "active"
  | "waiting"
  | "completed"
  | "success"
  | "error"
  | "idle";

export interface TerminalData {
  id: string;
  title: string;
  type: TerminalType;
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
  status: TerminalStatus;
  span: { cols: number; rows: number };
  scrollback?: string;
  sessionId?: string;
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
  worktrees: WorktreeData[];
}

export interface CanvasState {
  viewport: Viewport;
  projects: ProjectData[];
}

// Preload API types
export interface TermCanvasAPI {
  terminal: {
    create: (options: {
      cwd: string;
      shell?: string;
      args?: string[];
    }) => Promise<number>;
    destroy: (ptyId: number) => Promise<void>;
    getPid: (ptyId: number) => Promise<number | null>;
    input: (ptyId: number, data: string) => void;
    resize: (ptyId: number, cols: number, rows: number) => void;
    onOutput: (callback: (ptyId: number, data: string) => void) => () => void;
    onExit: (callback: (ptyId: number, exitCode: number) => void) => () => void;
    detectCli: (ptyId: number) => Promise<{ cliType: TerminalType; sessionName?: string } | null>;
  };
  session: {
    getCodexLatest: () => Promise<string | null>;
    getClaudeByPid: (pid: number) => Promise<string | null>;
    getKimiLatest: (cwd: string) => Promise<string | null>;
    watch: (type: string, sessionId: string, cwd: string) => Promise<void>;
    unwatch: (sessionId: string) => Promise<void>;
    onTurnComplete: (callback: (sessionId: string) => void) => () => void;
  };
  project: {
    selectDirectory: () => Promise<string | null>;
    scan: (dirPath: string) => Promise<{
      name: string;
      path: string;
      worktrees: { path: string; branch: string; isMain: boolean }[];
    } | null>;
    rescanWorktrees: (
      dirPath: string,
    ) => Promise<{ path: string; branch: string; isMain: boolean }[]>;
    diff: (worktreePath: string) => Promise<{
      diff: string;
      files: {
        name: string;
        additions: number;
        deletions: number;
        binary: boolean;
        isImage: boolean;
        imageOld: string | null;
        imageNew: string | null;
      }[];
    }>;
  };
  git: {
    watch: (worktreePath: string) => Promise<void>;
    unwatch: (worktreePath: string) => Promise<void>;
    onChanged: (callback: (worktreePath: string) => void) => () => void;
  };
  state: {
    load: () => Promise<CanvasState | null>;
    save: (state: unknown) => Promise<void>;
  };
  workspace: {
    save: (data: string) => Promise<boolean>;
    open: () => Promise<string | null>;
  };
  fs: {
    listDir: (dirPath: string) => Promise<{ name: string; isDirectory: boolean }[]>;
    readFile: (filePath: string) => Promise<
      | { type: string; content: string }
      | { error: string; size?: string }
    >;
  };
  cli: {
    isRegistered: () => Promise<boolean>;
    register: () => Promise<boolean>;
    unregister: () => Promise<boolean>;
  };
  app: {
    platform: "darwin" | "win32" | "linux";
    onBeforeClose: (callback: () => void) => () => void;
    confirmClose: () => void;
  };
}

declare global {
  interface Window {
    termcanvas: TermCanvasAPI;
  }
}
