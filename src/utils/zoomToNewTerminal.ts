import { packTerminals } from "../layout.ts";
import { useProjectStore } from "../stores/projectStore.ts";
import { panToWorktree } from "./panToWorktree.ts";
import { zoomToTerminal } from "./zoomToTerminal.ts";

function shouldCenterWorktreeForNewTerminal(
  terminalSpans: Array<{ cols: number; rows: number }>,
  terminalIndex: number,
) {
  const packed = packTerminals(terminalSpans);
  const nextItem = packed[terminalIndex];
  if (!nextItem) {
    return false;
  }

  let previousMaxRow = -1;
  for (let index = 0; index < terminalIndex; index += 1) {
    const item = packed[index];
    if (item) {
      previousMaxRow = Math.max(previousMaxRow, item.row);
    }
  }

  return nextItem.row > previousMaxRow;
}

interface ZoomToNewTerminalOptions {
  focus?: boolean;
}

export function zoomToNewTerminal(
  projectId: string,
  worktreeId: string,
  terminalId: string,
  options: ZoomToNewTerminalOptions = {},
) {
  const { projects, setFocusedTerminal } = useProjectStore.getState();
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    return;
  }

  const worktree = project.worktrees.find((item) => item.id === worktreeId);
  if (!worktree) {
    return;
  }

  const terminalIndex = worktree.terminals.findIndex(
    (terminal) => terminal.id === terminalId,
  );
  if (terminalIndex === -1) {
    return;
  }

  if (options.focus) {
    setFocusedTerminal(terminalId);
  }

  if (
    shouldCenterWorktreeForNewTerminal(
      worktree.terminals.map((terminal) => terminal.span),
      terminalIndex,
    )
  ) {
    panToWorktree(projectId, worktreeId);
    return;
  }

  zoomToTerminal(projectId, worktreeId, terminalId);
}
