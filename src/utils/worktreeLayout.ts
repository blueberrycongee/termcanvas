import type { WorktreeData } from "../types";

export function getVisibleWorktreeTerminals(
  worktree: Pick<WorktreeData, "terminals">,
) {
  return worktree.terminals.filter((terminal) => !terminal.stashed);
}
