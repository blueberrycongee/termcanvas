import type {
  ProjectData,
  TerminalStatus,
  TerminalType,
} from "../types/index.ts";

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
): SupportedTerminalOption[] {
  const options: SupportedTerminalOption[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.ptyId === null || !supportsComposer(terminal.type)) {
          continue;
        }

        options.push({
          terminalId: terminal.id,
          ptyId: terminal.ptyId,
          title: terminal.title,
          type: terminal.type,
          status: terminal.status,
          worktreePath: worktree.path,
          label: `${project.name} / ${worktree.name} / ${terminal.title}`,
          focused: terminal.focused,
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
