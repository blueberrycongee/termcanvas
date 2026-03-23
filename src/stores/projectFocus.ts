import type { ProjectData } from "../types/index.ts";

export interface NormalizedProjectFocus {
  projects: ProjectData[];
  focusedProjectId: string | null;
  focusedWorktreeId: string | null;
}

export interface TerminalFocusOrderItem {
  projectId: string;
  worktreeId: string;
  terminalId: string;
  index: number;
}

export interface WorktreeFocusOrderItem {
  projectId: string;
  worktreeId: string;
  index: number;
}

export function getWorktreeFocusOrder(
  projects: ProjectData[],
): WorktreeFocusOrderItem[] {
  const worktrees: Omit<WorktreeFocusOrderItem, "index">[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      worktrees.push({
        projectId: project.id,
        worktreeId: worktree.id,
      });
    }
  }

  return worktrees.map((w, index) => ({ ...w, index }));
}

export function getTerminalFocusOrder(
  projects: ProjectData[],
): TerminalFocusOrderItem[] {
  const terminals: Omit<TerminalFocusOrderItem, "index">[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        terminals.push({
          projectId: project.id,
          worktreeId: worktree.id,
          terminalId: terminal.id,
        });
      }
    }
  }

  return terminals.map((terminal, index) => ({ ...terminal, index }));
}

export function normalizeProjectsFocus(
  projects: ProjectData[],
): NormalizedProjectFocus {
  let focusedProjectId: string | null = null;
  let focusedWorktreeId: string | null = null;
  let focusedTerminalId: string | null = null;

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      const focusedTerminal = worktree.terminals.find((terminal) => terminal.focused);
      if (focusedTerminal) {
        focusedProjectId = project.id;
        focusedWorktreeId = worktree.id;
        focusedTerminalId = focusedTerminal.id;
        break;
      }
    }

    if (focusedTerminalId) {
      break;
    }
  }

  const normalizedProjects = projects.map((project) => ({
    ...project,
    worktrees: project.worktrees.map((worktree) => ({
      ...worktree,
      terminals: worktree.terminals.map((terminal) => ({
        ...terminal,
        focused: terminal.id === focusedTerminalId,
      })),
    })),
  }));

  return {
    projects: normalizedProjects,
    focusedProjectId,
    focusedWorktreeId,
  };
}
