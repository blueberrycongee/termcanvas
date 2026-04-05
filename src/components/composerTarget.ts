import type {
  ProjectData,
  TerminalStatus,
  TerminalType,
} from "../types/index.ts";
import { getTerminalDisplayTitle } from "../stores/terminalState.ts";
import {
  resolveTerminalWithRuntimeState,
  type TerminalRuntimeStateMap,
  useTerminalRuntimeStateStore,
} from "../stores/terminalRuntimeStateStore";

export interface SupportedTerminalOption {
  terminalId: string;
  ptyId: number;
  title: string;
  type: TerminalType;
  status: TerminalStatus;
  worktreePath: string;
  label: string;
  focused: boolean;
}

export type ComposerTargetState = "empty" | "no-target" | "ready";

export function getSupportedTerminals(
  projects: ProjectData[],
  supportsComposer: (terminalType: TerminalType) => boolean,
  terminalRuntimeStates: TerminalRuntimeStateMap =
    useTerminalRuntimeStateStore.getState().terminals,
): SupportedTerminalOption[] {
  const options: SupportedTerminalOption[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        const liveTerminal = resolveTerminalWithRuntimeState(
          terminal,
          terminalRuntimeStates[terminal.id],
        );

        if (
          liveTerminal.ptyId === null ||
          !supportsComposer(liveTerminal.type)
        ) {
          continue;
        }

        options.push({
          terminalId: liveTerminal.id,
          ptyId: liveTerminal.ptyId,
          title: getTerminalDisplayTitle(liveTerminal),
          type: liveTerminal.type,
          status: liveTerminal.status,
          worktreePath: worktree.path,
          label: `${project.name} / ${worktree.name} / ${getTerminalDisplayTitle(liveTerminal)}`,
          focused: liveTerminal.focused,
        });
      }
    }
  }

  return options;
}

export function resolveComposerTarget(
  supportedTerminals: SupportedTerminalOption[],
): SupportedTerminalOption | null {
  return supportedTerminals.find((terminal) => terminal.focused) ?? null;
}

export function getComposerTargetState(
  supportedTerminals: SupportedTerminalOption[],
  targetTerminal: SupportedTerminalOption | null,
): ComposerTargetState {
  if (supportedTerminals.length === 0) {
    return "empty";
  }

  if (!targetTerminal) {
    return "no-target";
  }

  return "ready";
}
