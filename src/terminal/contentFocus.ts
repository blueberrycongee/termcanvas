import type { TerminalType } from "../types/index.ts";

interface TerminalContentFocusActions {
  focusTerminal: () => void;
  focusTerminalInput: () => void;
}

export function focusTerminalContentTarget(
  _terminalType: TerminalType,
  _composerEnabled: boolean,
  actions: TerminalContentFocusActions,
) {
  actions.focusTerminal();
  actions.focusTerminalInput();
  return "terminal-input";
}
