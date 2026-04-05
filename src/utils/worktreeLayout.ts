import type { WorktreeData } from "../types";
import type { TerminalSpan } from "../layout";

export function getVisibleWorktreeTerminals(
  worktree: Pick<WorktreeData, "terminals">,
) {
  return worktree.terminals.filter((terminal) => !terminal.stashed);
}

export function getVisibleWorktreeSpans(
  worktree: Pick<WorktreeData, "terminals">,
): TerminalSpan[] {
  return getVisibleWorktreeTerminals(worktree).map((terminal) => terminal.span);
}
