import { useCallback, useRef, useMemo, useState } from "react";
import type { WorktreeData } from "../types";
import { useProjectStore, createTerminal } from "../stores/projectStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { useDrag } from "../hooks/useDrag";
import { useResize } from "../hooks/useResize";
import { DiffCard } from "../components/DiffCard";

interface Props {
  projectId: string;
  worktree: WorktreeData;
  parentSize: { w: number; h: number };
}

export function WorktreeContainer({ projectId, worktree, parentSize }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffPinned, setDiffPinned] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diffCardHovered = useRef(false);
  const {
    toggleWorktreeCollapse,
    addTerminal,
    updateWorktreeSize,
    updateWorktreePosition,
  } = useProjectStore();

  const handleDrag = useDrag(
    worktree.position.x,
    worktree.position.y,
    useCallback(
      (x: number, y: number) => {
        x = Math.max(0, x);
        y = Math.max(0, y);
        updateWorktreePosition(projectId, worktree.id, x, y);
      },
      [projectId, worktree.id, updateWorktreePosition],
    ),
  );

  const handleNewTerminal = useCallback(() => {
    const terminal = createTerminal("shell");
    const tW = terminal.size.w;
    const tH = terminal.size.h;
    const gap = 8;
    const pad = 10;
    const titleH = 36;
    const wtW = worktree.size.w || 580;
    const contentW = wtW - pad * 2;

    // Layout based on window aspect ratio
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const isLandscape = winW >= winH;

    let bestX = 0;
    let bestY = 0;

    if (worktree.terminals.length > 0) {
      let maxRight = 0;
      let maxBottom = 0;
      for (const t of worktree.terminals) {
        maxRight = Math.max(maxRight, t.position.x + t.size.w);
        maxBottom = Math.max(
          maxBottom,
          t.position.y + (t.minimized ? 30 : t.size.h),
        );
      }

      if (isLandscape) {
        // Landscape: place to the right
        bestX = maxRight + gap;
        bestY = 0;
      } else {
        // Portrait: place below
        bestX = 0;
        bestY = maxBottom + gap;
      }
    }

    terminal.position = { x: bestX, y: bestY };

    // Grow worktree if needed
    const neededW = Math.max(wtW, bestX + tW + pad * 2);
    const neededH = Math.max(
      worktree.size.h || 340,
      titleH + pad + bestY + tH + pad,
    );
    if (
      neededW > (worktree.size.w || 580) ||
      neededH > (worktree.size.h || 340)
    ) {
      updateWorktreeSize(projectId, worktree.id, neededW, neededH);
    }

    // Grow project if needed
    const wtBottom = worktree.position.y + neededH;
    const wtRight = worktree.position.x + neededW;
    const projPad = 12;
    const projTitleH = 40;
    const neededProjW = Math.max(parentSize.w || 620, wtRight + projPad * 2);
    const neededProjH = Math.max(
      parentSize.h || 400,
      projTitleH + projPad + wtBottom + projPad,
    );
    if (
      neededProjW > (parentSize.w || 620) ||
      neededProjH > (parentSize.h || 400)
    ) {
      useProjectStore
        .getState()
        .updateProjectSize(projectId, neededProjW, neededProjH);
    }

    addTerminal(projectId, worktree.id, terminal);
  }, [
    projectId,
    worktree.id,
    worktree.terminals,
    worktree.size,
    worktree.position,
    parentSize,
    addTerminal,
    updateWorktreeSize,
  ]);

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
      className="absolute rounded-md"
      style={{
        left: worktree.position.x,
        top: worktree.position.y,
        width: worktree.size.w > 0 ? worktree.size.w : undefined,
        minWidth: 300,
        height: worktree.size.h > 0 ? worktree.size.h : undefined,
        border: "1px solid var(--border)",
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
      <div
        className="flex items-center gap-2 px-3 py-2 select-none cursor-grab active:cursor-grabbing"
        onMouseDown={handleDrag}
      >
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
              worktreeSize={worktree.size}
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
