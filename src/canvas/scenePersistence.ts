import type {
  PersistedProjectData,
  PersistedStashedTerminal,
  PersistedWorktreeData,
  ProjectData,
  StashedTerminal,
  WorktreeData,
} from "../types";
import {
  restorePersistedTerminal,
  stripTerminalRuntimeState,
} from "../stores/terminalState";
import { resolveTerminalWithRuntimeState } from "../stores/terminalRuntimeStateStore";

export function toPersistedWorktreeData(
  worktree: WorktreeData,
  scrollbacks: Record<string, string>,
): PersistedWorktreeData {
  return {
    ...worktree,
    terminals: worktree.terminals.map((terminal) =>
      stripTerminalRuntimeState(resolveTerminalWithRuntimeState(terminal), {
        scrollback: scrollbacks[terminal.id] ?? terminal.scrollback ?? undefined,
      }),
    ),
  };
}

export function toPersistedProjectData(
  project: ProjectData,
  scrollbacks: Record<string, string>,
): PersistedProjectData {
  return {
    ...project,
    worktrees: project.worktrees.map((worktree) =>
      toPersistedWorktreeData(worktree, scrollbacks),
    ),
  };
}

export function restorePersistedWorktreeData(
  worktree: PersistedWorktreeData,
): WorktreeData {
  return {
    ...worktree,
    terminals: worktree.terminals.map(restorePersistedTerminal),
  };
}

export function restorePersistedProjectData(
  project: PersistedProjectData,
): ProjectData {
  return {
    ...project,
    worktrees: project.worktrees.map(restorePersistedWorktreeData),
  };
}

export function toPersistedStashedTerminal(
  entry: StashedTerminal,
  scrollbacks: Record<string, string>,
): PersistedStashedTerminal {
  return {
    ...entry,
    terminal: stripTerminalRuntimeState(
      resolveTerminalWithRuntimeState(entry.terminal),
      {
        scrollback:
          scrollbacks[entry.terminal.id] ??
          entry.terminal.scrollback ??
          undefined,
      },
    ),
  };
}

export function restorePersistedStashedTerminal(
  entry: PersistedStashedTerminal,
): StashedTerminal {
  return {
    ...entry,
    terminal: restorePersistedTerminal(entry.terminal),
  };
}
