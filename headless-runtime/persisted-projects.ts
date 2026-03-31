import type { ProjectData, TerminalData, TerminalStatus } from "./project-store.ts";

const LIVE_TERMINAL_STATUSES = new Set<TerminalStatus>([
  "running",
  "active",
  "waiting",
]);

function sanitizeTerminalForPersistence(terminal: TerminalData): TerminalData {
  return {
    ...terminal,
    ptyId: null,
    status: LIVE_TERMINAL_STATUSES.has(terminal.status)
      ? "idle"
      : terminal.status,
  };
}

export function sanitizeProjectsForPersistence(
  projects: ProjectData[],
): ProjectData[] {
  return projects.map((project) => ({
    ...project,
    worktrees: project.worktrees.map((worktree) => ({
      ...worktree,
      terminals: worktree.terminals.map(sanitizeTerminalForPersistence),
    })),
  }));
}
