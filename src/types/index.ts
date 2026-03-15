export type TerminalType = "shell" | "claude" | "codex";

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export type TerminalStatus = "running" | "success" | "error" | "idle";

export interface TerminalData {
  id: string;
  title: string;
  type: TerminalType;
  position: Position;
  size: Size;
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
  status: TerminalStatus;
  scrollback?: string;
  sessionId?: string;
}

export interface WorktreeData {
  id: string;
  name: string;
  path: string;
  position: Position;
  size: Size;
  collapsed: boolean;
  terminals: TerminalData[];
}

export interface ProjectData {
  id: string;
  name: string;
  path: string;
  position: Position;
  size: Size;
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
  };
  session: {
    getCodexLatest: () => Promise<string | null>;
    getClaudeByPid: (pid: number) => Promise<string | null>;
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
    watch: (dirPath: string) => void;
    unwatch: (dirPath: string) => void;
    onWorktreesChanged: (
      callback: (
        dirPath: string,
        worktrees: { path: string; branch: string; isMain: boolean }[],
      ) => void,
    ) => () => void;
  };
  state: {
    load: () => Promise<CanvasState | null>;
    save: (state: CanvasState) => Promise<void>;
  };
}

declare global {
  interface Window {
    termcanvas: TermCanvasAPI;
  }
}
