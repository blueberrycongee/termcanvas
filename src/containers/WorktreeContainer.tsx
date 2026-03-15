import { useCallback, useRef, useMemo, useState } from "react";
import type { WorktreeData } from "../types";
import { useProjectStore, createTerminal } from "../stores/projectStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { useResize } from "../hooks/useResize";
import { DiffCard } from "../components/DiffCard";

interface Props {
  projectId: string;
  worktree: WorktreeData;
}

export function WorktreeContainer({ projectId, worktree }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffPinned, setDiffPinned] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diffCardHovered = useRef(false);
  const { toggleWorktreeCollapse, addTerminal, updateWorktreeSize } =
    useProjectStore();

  const handleNewTerminal = useCallback(() => {
    const terminal = createTerminal("shell");
    addTerminal(projectId, worktree.id, terminal);
  }, [projectId, worktree.id, addTerminal]);

  const contentMinH = useMemo(() => {
    if (worktree.terminals.length === 0) return 60;
    let maxBottom = 0;
    for (const t of worktree.terminals) {
      if (t.minimized) {
        maxBottom = Math.max(maxBottom, t.position.y + 30);
      } else {
        maxBottom = Math.max(maxBottom, t.position.y + (t.size.h || 320));
      }
    }
    return Math.max(60, maxBottom);
  }, [worktree.terminals]);

  const childMinW = useMemo(() => {
    if (worktree.terminals.length === 0) return 300;
    let maxRight = 0;
    for (const t of worktree.terminals) {
      maxRight = Math.max(maxRight, t.position.x + t.size.w);
    }
    return Math.max(300, maxRight + 20 + 2);
  }, [worktree.terminals]);

  const childMinH = useMemo(() => {
    if (worktree.terminals.length === 0) return 100;
    return Math.max(100, contentMinH + 36 + 16 + 2);
  }, [contentMinH]);

  const handleResize = useResize(
    worktree.size.w,
    worktree.size.h,
    useCallback(
      (w: number, h: number) => {
        if (containerRef.current) {
          w = Math.max(w, containerRef.current.scrollWidth);
          h = Math.max(h, containerRef.current.scrollHeight);
        }
        updateWorktreeSize(projectId, worktree.id, w, h);
      },
      [projectId, worktree.id, updateWorktreeSize],
    ),
    childMinW,
    childMinH,
    containerRef,
  );

  return (
    <div
      ref={containerRef}
      className="relative rounded-md"
      style={{
        width: worktree.size.w > 0 ? worktree.size.w : undefined,
        minWidth: 300,
        height: worktree.size.h > 0 ? worktree.size.h : undefined,
        borderLeft: "2px solid var(--border)",
      }}
      onMouseEnter={() => {
        if (diffPinned) return;
        if (leaveTimeout.current) {
          clearTimeout(leaveTimeout.current);
          leaveTimeout.current = null;
        }
        hoverTimeout.current = setTimeout(() => setShowDiff(true), 400);
      }}
      onMouseLeave={() => {
        if (hoverTimeout.current) {
          clearTimeout(hoverTimeout.current);
          hoverTimeout.current = null;
        }
        if (!diffPinned) {
          leaveTimeout.current = setTimeout(() => {
            if (!diffCardHovered.current) setShowDiff(false);
          }, 300);
        }
      }}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-2 select-none">
        <span
          className="text-[11px] text-[var(--text-secondary)] truncate font-medium"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {worktree.name}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={() => toggleWorktreeCollapse(projectId, worktree.id)}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              className={`transition-transform duration-150 ${worktree.collapsed ? "-rotate-90" : ""}`}
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
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
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
        <div
          className="px-2 pb-2 relative overflow-hidden"
          style={{ minHeight: contentMinH }}
        >
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
              className="w-full py-6 rounded-md text-[var(--text-faint)] text-[11px] hover:text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-colors duration-150"
              onClick={handleNewTerminal}
            >
              + New Terminal
            </button>
          )}
        </div>
      )}

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 hover:opacity-100 transition-opacity duration-150"
        onMouseDown={handleResize}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className="text-[var(--text-faint)]"
        >
          <path
            d="M11 11L6 11M11 11L11 6"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Diff card */}
      {showDiff && (
        <DiffCard
          worktreeId={worktree.id}
          worktreePath={worktree.path}
          anchorX={worktree.size.w > 0 ? worktree.size.w : 300}
          anchorY={0}
          pinned={diffPinned}
          onPin={() => setDiffPinned(true)}
          onClose={() => {
            setDiffPinned(false);
            setShowDiff(false);
          }}
          onMouseEnter={() => {
            diffCardHovered.current = true;
            if (leaveTimeout.current) {
              clearTimeout(leaveTimeout.current);
              leaveTimeout.current = null;
            }
          }}
          onMouseLeave={() => {
            diffCardHovered.current = false;
            if (!diffPinned) {
              leaveTimeout.current = setTimeout(() => setShowDiff(false), 300);
            }
          }}
        />
      )}

      {/* Connection line to diff card */}
      {showDiff && (
        <svg
          className="absolute pointer-events-none"
          style={{
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        >
          <line
            x1={worktree.size.w > 0 ? worktree.size.w : 300}
            y1={20}
            x2={(worktree.size.w > 0 ? worktree.size.w : 300) + 16}
            y2={20}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray={diffPinned ? "none" : "3 3"}
            className="transition-all duration-150"
          />
        </svg>
      )}
    </div>
  );
}
