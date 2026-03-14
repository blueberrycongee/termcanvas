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

export interface TerminalData {
  id: string;
  title: string;
  type: TerminalType;
  position: Position;
  size: Size;
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
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
  worktrees: WorktreeData[];
}

export interface CanvasState {
  viewport: Viewport;
  projects: ProjectData[];
}

// Preload API types
export interface TermCanvasAPI {
  terminal: {
    create: (options: { cwd: string; shell?: string }) => Promise<number>;
    destroy: (ptyId: number) => Promise<void>;
    input: (ptyId: number, data: string) => void;
    resize: (ptyId: number, cols: number, rows: number) => void;
    onOutput: (callback: (ptyId: number, data: string) => void) => () => void;
    onExit: (callback: (ptyId: number, exitCode: number) => void) => () => void;
  };
  project: {
    selectDirectory: () => Promise<string | null>;
    scan: (dirPath: string) => Promise<{
      name: string;
      path: string;
      worktrees: { path: string; branch: string; isMain: boolean }[];
    } | null>;
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
