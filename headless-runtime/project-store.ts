/**
 * Pure Node.js in-memory project store that replaces the React/Zustand projectStore.
 * Provides the same data model and operations for the headless runtime.
 */

export type TerminalType =
  | "shell"
  | "claude"
  | "codex"
  | "kimi"
  | "gemini"
  | "opencode"
  | "wuu"
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
}

export interface WorktreeData {
  id: string;
  name: string;
  path: string;
  position: { x: number; y: number };
  collapsed: boolean;
  terminals: TerminalData[];
}

export interface ProjectData {
  id: string;
  name: string;
  path: string;
  position: { x: number; y: number };
  collapsed: boolean;
  zIndex: number;
  worktrees: WorktreeData[];
}

export interface EnrichedTerminal {
  id: string;
  title: string;
  customTitle?: string;
  starred?: boolean;
  type: TerminalType;
  status: TerminalStatus;
  ptyId: number | null;
  span: { cols: number; rows: number };
  parentTerminalId?: string;
  projectId: string;
  worktreeId: string;
  worktreePath: string;
}

interface ScannedWorktree {
  path: string;
  branch: string;
  isPrimary: boolean;
}

let idCounter = 0;

export function generateId(): string {
  return `${Date.now()}-${++idCounter}`;
}

export class ProjectStore {
  private projects: ProjectData[] = [];

  addProject(project: ProjectData): void {
    this.projects.push(project);
  }

  removeProject(projectId: string): void {
    this.projects = this.projects.filter((p) => p.id !== projectId);
  }

  getProjects(): ProjectData[] {
    return this.projects;
  }

  getProjectById(projectId: string): ProjectData | undefined {
    return this.projects.find((p) => p.id === projectId);
  }

  findProjectByPath(projectPath: string): ProjectData | undefined {
    return this.projects.find((p) => p.path === projectPath);
  }

  addTerminal(
    projectId: string,
    worktreeId: string,
    type: TerminalType = "shell",
    prompt?: string,
    autoApprove?: boolean,
    parentTerminalId?: string,
  ): TerminalData {
    const terminal: TerminalData = {
      id: generateId(),
      title: type === "shell" ? "Terminal" : type,
      type,
      minimized: false,
      focused: false,
      ptyId: null,
      status: "idle",
      span: { cols: 1, rows: 1 },
      origin: "agent",
      ...(prompt ? { initialPrompt: prompt } : {}),
      ...(autoApprove ? { autoApprove } : {}),
      ...(parentTerminalId ? { parentTerminalId } : {}),
    };

    this.projects = this.projects.map((p) =>
      p.id !== projectId
        ? p
        : {
            ...p,
            worktrees: p.worktrees.map((w) =>
              w.id !== worktreeId
                ? w
                : { ...w, terminals: [...w.terminals, terminal] },
            ),
          },
    );

    return terminal;
  }

  removeTerminal(
    projectId: string,
    worktreeId: string,
    terminalId: string,
  ): void {
    this.projects = this.projects.map((p) =>
      p.id !== projectId
        ? p
        : {
            ...p,
            worktrees: p.worktrees.map((w) =>
              w.id !== worktreeId
                ? w
                : {
                    ...w,
                    terminals: w.terminals.filter((t) => t.id !== terminalId),
                  },
            ),
          },
    );
  }

  getTerminal(terminalId: string): EnrichedTerminal | null {
    for (const p of this.projects) {
      for (const w of p.worktrees) {
        const t = w.terminals.find((t) => t.id === terminalId);
        if (t) {
          return {
            id: t.id,
            title: t.title,
            customTitle: t.customTitle,
            starred: t.starred,
            type: t.type,
            status: t.status,
            ptyId: t.ptyId,
            span: t.span,
            parentTerminalId: t.parentTerminalId,
            projectId: p.id,
            worktreeId: w.id,
            worktreePath: w.path,
          };
        }
      }
    }
    return null;
  }

  listTerminals(worktreePath?: string | null): Array<{
    id: string;
    title: string;
    type: TerminalType;
    status: TerminalStatus;
    ptyId: number | null;
    worktree: string;
    project: string;
  }> {
    const result: Array<{
      id: string;
      title: string;
      type: TerminalType;
      status: TerminalStatus;
      ptyId: number | null;
      worktree: string;
      project: string;
    }> = [];

    for (const p of this.projects) {
      for (const w of p.worktrees) {
        if (worktreePath && w.path !== worktreePath) continue;
        for (const t of w.terminals) {
          result.push({
            id: t.id,
            title: t.title,
            type: t.type,
            status: t.status,
            ptyId: t.ptyId,
            worktree: w.path,
            project: p.name,
          });
        }
      }
    }
    return result;
  }

  updateTerminalPtyId(
    projectId: string,
    worktreeId: string,
    terminalId: string,
    ptyId: number | null,
  ): void {
    this.mapTerminal(projectId, worktreeId, terminalId, (t) => ({
      ...t,
      ptyId,
    }));
  }

  updateTerminalStatus(
    projectId: string,
    worktreeId: string,
    terminalId: string,
    status: TerminalStatus,
  ): void {
    this.mapTerminal(projectId, worktreeId, terminalId, (t) => ({
      ...t,
      status,
    }));
  }

  setCustomTitle(terminalId: string, customTitle: string): boolean {
    for (const p of this.projects) {
      for (const w of p.worktrees) {
        const t = w.terminals.find((t) => t.id === terminalId);
        if (t) {
          this.mapTerminal(p.id, w.id, terminalId, (t) => ({
            ...t,
            customTitle: customTitle.trim() || undefined,
          }));
          return true;
        }
      }
    }
    return false;
  }

  syncWorktrees(
    projectPath: string,
    worktrees: ScannedWorktree[],
  ): void {
    this.projects = this.projects.map((project) => {
      if (project.path !== projectPath) return project;

      const existingByPath = new Map(
        project.worktrees.map((w) => [w.path, w]),
      );

      const synced = worktrees.map((wt) => {
        const existing = existingByPath.get(wt.path);
        if (!existing) {
          return {
            id: generateId(),
            name: wt.branch,
            path: wt.path,
            position: { x: 0, y: 0 },
            collapsed: true,
            terminals: [],
          };
        }
        if (existing.name === wt.branch) {
          return existing;
        }
        return { ...existing, name: wt.branch };
      });

      return { ...project, worktrees: synced };
    });
  }

  findWorktree(
    worktreePath: string,
  ): { projectId: string; worktreeId: string } | null {
    for (const p of this.projects) {
      for (const w of p.worktrees) {
        if (w.path === worktreePath) {
          return { projectId: p.id, worktreeId: w.id };
        }
      }
    }
    return null;
  }

  private mapTerminal(
    projectId: string,
    worktreeId: string,
    terminalId: string,
    fn: (t: TerminalData) => TerminalData,
  ): void {
    this.projects = this.projects.map((p) =>
      p.id !== projectId
        ? p
        : {
            ...p,
            worktrees: p.worktrees.map((w) =>
              w.id !== worktreeId
                ? w
                : {
                    ...w,
                    terminals: w.terminals.map((t) =>
                      t.id !== terminalId ? t : fn(t),
                    ),
                  },
            ),
          },
    );
  }
}
