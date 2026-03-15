import { useCallback, useRef, useMemo, useState } from "react";
import type { WorktreeData } from "../types";
import { useProjectStore, createTerminal } from "../stores/projectStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { useDrag } from "../hooks/useDrag";
import { useResize } from "../hooks/useResize";
import { DiffCard } from "../components/DiffCard";
import { useT } from "../i18n/useT";

interface Props {
  projectId: string;
  worktree: WorktreeData;
  parentSize: { w: number; h: number };
}

export function WorktreeContainer({ projectId, worktree, parentSize }: Props) {
  const t = useT();
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

    // Total terminal count after adding the new one
    const totalCount = worktree.terminals.length + 1;

    // Compute optimal cols/rows based on window aspect ratio
    const aspect = window.innerWidth / window.innerHeight;
    const cols = Math.round(Math.sqrt(totalCount * aspect));
    const rows = Math.ceil(totalCount / Math.max(1, cols));

    // Reposition ALL terminals into the grid
    const allTerminals = [...worktree.terminals];
    for (let i = 0; i < allTerminals.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      allTerminals[i] = {
        ...allTerminals[i],
        position: { x: col * (tW + gap), y: row * (tH + gap) },
      };
    }

    // Position the new terminal
    const newCol = worktree.terminals.length % cols;
    const newRow = Math.floor(worktree.terminals.length / cols);
    terminal.position = { x: newCol * (tW + gap), y: newRow * (tH + gap) };

    // Update all existing terminal positions
    for (const t of allTerminals) {
      useProjectStore
        .getState()
        .updateTerminalPosition(
          projectId,
          worktree.id,
          t.id,
          t.position.x,
          t.position.y,
        );
    }

    // Compute needed container sizes
    const neededW = cols * tW + (cols - 1) * gap + pad * 2;
    const neededH = titleH + pad + rows * tH + (rows - 1) * gap + pad;

    // Grow worktree
    const wtW = Math.max(worktree.size.w || 580, neededW);
    const wtH = Math.max(worktree.size.h || 340, neededH);
    updateWorktreeSize(projectId, worktree.id, wtW, wtH);

    // Grow project
    const wtBottom = worktree.position.y + wtH;
    const wtRight = worktree.position.x + wtW;
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
            title={t.new_terminal}
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
              {t.new_terminal_btn}
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
