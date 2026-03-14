import { useCallback, useRef } from "react";
import type { WorktreeData } from "../types";
import { useProjectStore, createTerminal } from "../stores/projectStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { useResize } from "../hooks/useResize";

interface Props {
  projectId: string;
  worktree: WorktreeData;
}

export function WorktreeContainer({ projectId, worktree }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { toggleWorktreeCollapse, addTerminal, updateWorktreeSize } =
    useProjectStore();

  const handleNewTerminal = useCallback(() => {
    const terminal = createTerminal("shell");
    addTerminal(projectId, worktree.id, terminal);
  }, [projectId, worktree.id, addTerminal]);

  const handleResize = useResize(
    worktree.size.w,
    worktree.size.h,
    useCallback(
      (w: number, h: number) =>
        updateWorktreeSize(projectId, worktree.id, w, h),
      [projectId, worktree.id, updateWorktreeSize],
    ),
    300,
    100,
    containerRef,
  );

  return (
    <div
      ref={containerRef}
      className="relative panel-inner"
      style={{
        width: worktree.size.w > 0 ? worktree.size.w : undefined,
        minWidth: 300,
        height: worktree.size.h > 0 ? worktree.size.h : undefined,
      }}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-2 select-none border-b border-[#333]">
        <span className="type-badge bg-[#111] text-[#888]">WT</span>
        <span
          className="text-xs text-[#ededed] truncate font-medium"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {worktree.name}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="text-[#666] hover:text-[#ededed] transition-colors p-1 rounded hover:bg-[#111]"
            onClick={() => toggleWorktreeCollapse(projectId, worktree.id)}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              className={`transition-transform ${worktree.collapsed ? "-rotate-90" : ""}`}
            >
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            className="text-[#666] hover:text-[#ededed] transition-colors p-1 rounded hover:bg-[#111]"
            onClick={handleNewTerminal}
            title="New terminal"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 2V10M2 6H10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminals */}
      {!worktree.collapsed && (
        <div className="p-2.5 relative overflow-auto" style={{ minHeight: 60 }}>
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
              className="w-full py-8 rounded-md border border-dashed border-[#333] text-[#666] text-xs hover:border-[#444] hover:text-[#888] transition-all"
              onClick={handleNewTerminal}
            >
              + New Terminal
            </button>
          )}
        </div>
      )}

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 hover:opacity-100 transition-opacity"
        onMouseDown={handleResize}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" className="text-[#444]">
          <path
            d="M11 11L6 11M11 11L11 6"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
