import { create } from "zustand";
import type {
  ProjectData,
  WorktreeData,
  TerminalData,
  TerminalType,
  TerminalStatus,
} from "../types";

interface ProjectStore {
  projects: ProjectData[];

  addProject: (project: ProjectData) => void;
  removeProject: (projectId: string) => void;
  updateProjectPosition: (projectId: string, x: number, y: number) => void;
  updateProjectSize: (projectId: string, w: number, h: number) => void;
  toggleProjectCollapse: (projectId: string) => void;
  bringToFront: (projectId: string) => void;

  updateWorktreePosition: (
    projectId: string,
    worktreeId: string,
    x: number,
    y: number,
  ) => void;
  updateWorktreeSize: (
    projectId: string,
    worktreeId: string,
    w: number,
    h: number,
  ) => void;
  toggleWorktreeCollapse: (projectId: string, worktreeId: string) => void;
  syncWorktrees: (
    projectPath: string,
    worktrees: { path: string; branch: string; isMain: boolean }[],
  ) => void;

  addTerminal: (
    projectId: string,
    worktreeId: string,
    terminal: TerminalData,
  ) => void;
  removeTerminal: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
  ) => void;
  updateTerminalPosition: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    x: number,
    y: number,
  ) => void;
  updateTerminalSize: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    w: number,
    h: number,
  ) => void;
  updateTerminalPtyId: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    ptyId: number,
  ) => void;
  toggleTerminalMinimize: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
  ) => void;
  updateTerminalStatus: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    status: TerminalStatus,
  ) => void;
  updateTerminalSessionId: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    sessionId: string,
  ) => void;
  setFocusedTerminal: (terminalId: string | null) => void;

  setProjects: (projects: ProjectData[]) => void;
}

let idCounter = 0;
export function generateId(): string {
  return `${Date.now()}-${++idCounter}`;
}

export function createTerminal(
  type: TerminalType = "shell",
  title?: string,
): TerminalData {
  return {
    id: generateId(),
    title: title ?? (type === "shell" ? "Terminal" : type),
    type,
    position: { x: 0, y: 0 },
    size: { w: 540, h: 260 },
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
  };
}

function mapTerminals(
  projects: ProjectData[],
  projectId: string,
  worktreeId: string,
  terminalId: string,
  fn: (t: TerminalData) => TerminalData,
): ProjectData[] {
  return projects.map((p) =>
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

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],

  addProject: (project) =>
    set((state) => ({ projects: [...state.projects, project] })),

  removeProject: (projectId) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
    })),

  updateProjectPosition: (projectId, x, y) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id !== projectId ? p : { ...p, position: { x, y } },
      ),
    })),

  updateProjectSize: (projectId, w, h) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id !== projectId ? p : { ...p, size: { w, h } },
      ),
    })),

  toggleProjectCollapse: (projectId) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id !== projectId ? p : { ...p, collapsed: !p.collapsed },
      ),
    })),

  bringToFront: (projectId) =>
    set((state) => {
      const maxZ = Math.max(0, ...state.projects.map((p) => p.zIndex ?? 0));
      return {
        projects: state.projects.map((p) =>
          p.id !== projectId ? p : { ...p, zIndex: maxZ + 1 },
        ),
      };
    }),

  updateWorktreePosition: (projectId, worktreeId, x, y) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              worktrees: p.worktrees.map((w) =>
                w.id !== worktreeId ? w : { ...w, position: { x, y } },
              ),
            },
      ),
    })),

  updateWorktreeSize: (projectId, worktreeId, w, h) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              worktrees: p.worktrees.map((wt) =>
                wt.id !== worktreeId ? wt : { ...wt, size: { w, h } },
              ),
            },
      ),
    })),

  syncWorktrees: (projectPath, worktrees) =>
    set((state) => ({
      projects: state.projects.map((p) => {
        if (p.path !== projectPath) return p;
        // Keep existing worktrees that still exist, add new ones
        const existingByPath = new Map(p.worktrees.map((w) => [w.path, w]));
        const synced = worktrees.map((wt) => {
          const existing = existingByPath.get(wt.path);
          if (existing) {
            // Keep existing state (terminals, size, etc), update branch name
            return { ...existing, name: wt.branch };
          }
          // New worktree
          return {
            id: generateId(),
            name: wt.branch,
            path: wt.path,
            position: { x: 0, y: 0 },
            size: { w: p.size.w > 0 ? p.size.w - 40 : 580, h: 0 },
            collapsed: false,
            terminals: [],
          };
        });
        return { ...p, worktrees: synced };
      }),
    })),

  toggleWorktreeCollapse: (projectId, worktreeId) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              worktrees: p.worktrees.map((w) =>
                w.id !== worktreeId ? w : { ...w, collapsed: !w.collapsed },
              ),
            },
      ),
    })),

  addTerminal: (projectId, worktreeId, terminal) =>
    set((state) => ({
      projects: state.projects.map((p) =>
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
      ),
    })),

  removeTerminal: (projectId, worktreeId, terminalId) =>
    set((state) => ({
      projects: state.projects.map((p) =>
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
      ),
    })),

  updateTerminalPosition: (projectId, worktreeId, terminalId, x, y) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, position: { x, y } }),
      ),
    })),

  updateTerminalSize: (projectId, worktreeId, terminalId, w, h) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, size: { w, h } }),
      ),
    })),

  updateTerminalPtyId: (projectId, worktreeId, terminalId, ptyId) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, ptyId }),
      ),
    })),

  toggleTerminalMinimize: (projectId, worktreeId, terminalId) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, minimized: !t.minimized }),
      ),
    })),

  updateTerminalStatus: (projectId, worktreeId, terminalId, status) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, status }),
      ),
    })),

  updateTerminalSessionId: (projectId, worktreeId, terminalId, sessionId) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, sessionId }),
      ),
    })),

  setFocusedTerminal: (terminalId) =>
    set((state) => ({
      projects: state.projects.map((p) => ({
        ...p,
        worktrees: p.worktrees.map((w) => ({
          ...w,
          terminals: w.terminals.map((t) => ({
            ...t,
            focused: t.id === terminalId,
          })),
        })),
      })),
    })),

  setProjects: (projects) => set({ projects }),
}));
