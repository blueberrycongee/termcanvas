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
        if (terminal.minimized || terminal.stashed) {
          continue;
        }

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

/**
 * Spatial (top-left → bottom-right) terminal order. Drives cmd+] / cmd+[
 * navigation on the free canvas so "next terminal" follows what the user
 * sees on screen instead of the insertion-order of the underlying arrays,
 * which made sense on the old grid layout but is disorienting now that
 * terminals can live anywhere.
 *
 * Sort key is (y asc, x asc, terminalId asc) — strict scanline order with
 * the id as a deterministic tiebreaker. Stashed / minimized terminals are
 * excluded the same way insertion order excludes them.
 */
export function getSpatialTerminalOrder(
  projects: ProjectData[],
): TerminalFocusOrderItem[] {
  const entries: Array<
    Omit<TerminalFocusOrderItem, "index"> & { x: number; y: number }
  > = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.minimized || terminal.stashed) {
          continue;
        }
        entries.push({
          projectId: project.id,
          worktreeId: worktree.id,
          terminalId: terminal.id,
          x: terminal.x,
          y: terminal.y,
        });
      }
    }
  }

  entries.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.terminalId.localeCompare(b.terminalId);
  });

  return entries.map((entry, index) => ({
    projectId: entry.projectId,
    worktreeId: entry.worktreeId,
    terminalId: entry.terminalId,
    index,
  }));
}

/**
 * Given the projects before and after a collapse, find the next visible
 * terminal to receive focus. Walks forward from the old focused position,
 * wrapping around if needed.
 */
export function findNextVisibleTerminalId(
  oldProjects: ProjectData[],
  focusedTerminalId: string,
  newProjects: ProjectData[],
): string | null {
  const oldOrder = getTerminalFocusOrder(oldProjects);
  const newOrder = getTerminalFocusOrder(newProjects);

  if (newOrder.length === 0) return null;

  const oldIdx = oldOrder.findIndex((t) => t.terminalId === focusedTerminalId);
  if (oldIdx === -1) return newOrder[0].terminalId;

  const newIds = new Set(newOrder.map((t) => t.terminalId));

  for (let i = oldIdx + 1; i < oldOrder.length; i++) {
    if (newIds.has(oldOrder[i].terminalId)) {
      return oldOrder[i].terminalId;
    }
  }

  for (let i = 0; i < oldIdx; i++) {
    if (newIds.has(oldOrder[i].terminalId)) {
      return oldOrder[i].terminalId;
    }
  }

  return newOrder[0].terminalId;
}

export function normalizeProjectsFocus(
  projects: ProjectData[],
): NormalizedProjectFocus {
  let focusedProjectId: string | null = null;
  let focusedWorktreeId: string | null = null;
  let focusedTerminalId: string | null = null;

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      const focusedTerminal = worktree.terminals.find(
        (terminal) => terminal.focused,
      );
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
