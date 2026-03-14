import { create } from "zustand";
import type {
  ProjectData,
  WorktreeData,
  TerminalData,
  TerminalType,
} from "../types";

interface ProjectStore {
  projects: ProjectData[];

  addProject: (project: ProjectData) => void;
  removeProject: (projectId: string) => void;
  updateProjectPosition: (projectId: string, x: number, y: number) => void;
  toggleProjectCollapse: (projectId: string) => void;

  updateWorktreePosition: (
    projectId: string,
    worktreeId: string,
    x: number,
    y: number,
  ) => void;
  toggleWorktreeCollapse: (projectId: string, worktreeId: string) => void;

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
    size: { w: 500, h: 320 },
    minimized: false,
    focused: false,
    ptyId: null,
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

  toggleProjectCollapse: (projectId) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id !== projectId ? p : { ...p, collapsed: !p.collapsed },
      ),
    })),

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
