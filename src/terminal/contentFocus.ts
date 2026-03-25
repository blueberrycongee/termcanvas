import type { TerminalType } from "../types/index.ts";
import { getComposerAdapter } from "./cliConfig.ts";

interface TerminalContentFocusActions {
  focusTerminal: () => void;
  focusTerminalInput: () => void;
}

export function focusTerminalContentTarget(
  terminalType: TerminalType,
  composerEnabled: boolean,
  actions: TerminalContentFocusActions,
) {
  const adapter = getComposerAdapter(terminalType);

  if (!adapter || adapter.inputMode === "type" || !composerEnabled) {
    actions.focusTerminalInput();
    return "terminal-input";
  }

  actions.focusTerminal();
  return "composer";
}
