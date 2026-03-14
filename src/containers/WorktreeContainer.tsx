import { useCallback } from "react";
import type { WorktreeData } from "../types";
import { useProjectStore, createTerminal } from "../stores/projectStore";
import { TerminalTile } from "../terminal/TerminalTile";

interface Props {
  projectId: string;
  worktree: WorktreeData;
}

export function WorktreeContainer({ projectId, worktree }: Props) {
  const { toggleWorktreeCollapse, addTerminal } = useProjectStore();

  const handleNewTerminal = useCallback(() => {
    const terminal = createTerminal("shell");
    addTerminal(projectId, worktree.id, terminal);
  }, [projectId, worktree.id, addTerminal]);

  return (
    <div className="rounded-lg border border-zinc-600 bg-zinc-800/60 min-w-[180px]">
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 select-none border-b border-zinc-700"
        onDoubleClick={() => toggleWorktreeCollapse(projectId, worktree.id)}
      >
        <span className="text-xs font-mono text-green-400">WT</span>
        <span className="text-xs text-zinc-300 truncate">{worktree.name}</span>
        <button
          className="ml-auto text-zinc-500 hover:text-zinc-300 text-xs"
          onClick={() => toggleWorktreeCollapse(projectId, worktree.id)}
        >
          {worktree.collapsed ? "▸" : "▾"}
        </button>
        <button
          className="text-zinc-500 hover:text-zinc-300 text-sm leading-none"
          onClick={handleNewTerminal}
          title="New terminal"
        >
          +
        </button>
      </div>

      {/* Terminals */}
      {!worktree.collapsed && (
        <div className="p-2 flex flex-wrap gap-2">
          {worktree.terminals.map((terminal) => (
            <TerminalTile
              key={terminal.id}
              projectId={projectId}
              worktreeId={worktree.id}
              worktreePath={worktree.path}
              terminal={terminal}
            />
          ))}
          {worktree.terminals.length === 0 && (
            <button
              className="w-full py-6 rounded border border-dashed border-zinc-600 text-zinc-500 text-xs hover:border-zinc-400 hover:text-zinc-400 transition-colors"
              onClick={handleNewTerminal}
            >
              + New Terminal
            </button>
          )}
        </div>
      )}
    </div>
  );
}
