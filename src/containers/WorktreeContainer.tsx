import { useCallback, useRef, useState } from "react";
import type { WorktreeData } from "../types";
import { useProjectStore, createTerminal } from "../stores/projectStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { useDrag } from "../hooks/useDrag";
import { DiffCard } from "../components/DiffCard";
import { useT } from "../i18n/useT";
import { useCanvasStore } from "../stores/canvasStore";
import {
  computeGridCols,
  computeWorktreeSize,
  computeTerminalPosition,
  WT_PAD,
  WT_TITLE_H,
  TERMINAL_W,
  TERMINAL_H,
  GRID_GAP,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";

interface Props {
  projectId: string;
  worktree: WorktreeData;
}

export function WorktreeContainer({ projectId, worktree }: Props) {
  const t = useT();
  const [showDiff, setShowDiff] = useState(false);
  const [diffPinned, setDiffPinned] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diffCardHovered = useRef(false);
  const {
    toggleWorktreeCollapse,
    addTerminal,
    updateWorktreePosition,
    reorderTerminal,
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
    addTerminal(projectId, worktree.id, terminal);
  }, [projectId, worktree.id, addTerminal]);

  const [dragState, setDragState] = useState<{
    terminalId: string;
    offsetX: number;
    offsetY: number;
    targetIndex: number;
  } | null>(null);

  const terminalCount = worktree.terminals.length;
  const cols = computeGridCols(terminalCount);
  const computedSize = computeWorktreeSize(terminalCount);

  const handleZoomToFit = useCallback(
    (index: number) => {
      const project = useProjectStore
        .getState()
        .projects.find((p) => p.id === projectId);
      if (!project) return;

      const { x: gridX, y: gridY } = computeTerminalPosition(index, cols);
      // Absolute position on canvas: project pos + proj padding + worktree pos + wt title + wt pad + grid pos
      const absX =
        project.position.x + PROJ_PAD + worktree.position.x + WT_PAD + gridX;
      const absY =
        project.position.y +
        PROJ_TITLE_H +
        PROJ_PAD +
        worktree.position.y +
        WT_TITLE_H +
        WT_PAD +
        gridY;

      const padding = 60;
      const viewW = window.innerWidth - padding * 2;
      const viewH = window.innerHeight - padding * 2;
      const scale = Math.min(viewW / TERMINAL_W, viewH / TERMINAL_H) * 0.85;

      const centerX = -(absX + TERMINAL_W / 2) * scale + window.innerWidth / 2;
      const centerY = -(absY + TERMINAL_H / 2) * scale + window.innerHeight / 2;

      useCanvasStore.getState().animateTo(centerX, centerY, scale);
    },
    [projectId, worktree.position, cols],
  );

  const handleTerminalDragStart = useCallback(
    (terminalId: string, e: React.MouseEvent) => {
      const origIndex = worktree.terminals.findIndex(
        (t) => t.id === terminalId,
      );
      if (origIndex === -1) return;
      e.preventDefault();
      e.stopPropagation();
      const scale = useCanvasStore.getState().viewport.scale;
      const startX = e.clientX;
      const startY = e.clientY;

      setDragState({
        terminalId,
        offsetX: 0,
        offsetY: 0,
        targetIndex: origIndex,
      });

      const handleMove = (ev: MouseEvent) => {
        const ox = (ev.clientX - startX) / scale;
        const oy = (ev.clientY - startY) / scale;

        // Compute which grid cell the center of the dragged terminal is over
        const origPos = computeTerminalPosition(origIndex, cols);
        const cx = origPos.x + ox + TERMINAL_W / 2;
        const cy = origPos.y + oy + TERMINAL_H / 2;
        const col = Math.max(
          0,
          Math.min(cols - 1, Math.floor(cx / (TERMINAL_W + GRID_GAP))),
        );
        const row = Math.max(0, Math.floor(cy / (TERMINAL_H + GRID_GAP)));
        const targetIndex = Math.min(
          worktree.terminals.length - 1,
          Math.max(0, row * cols + col),
        );

        setDragState({
          terminalId,
          offsetX: ox,
          offsetY: oy,
          targetIndex,
        });
      };

      const handleUp = () => {
        setDragState((prev) => {
          if (prev && prev.targetIndex !== origIndex) {
            reorderTerminal(
              projectId,
              worktree.id,
              prev.terminalId,
              prev.targetIndex,
            );
          }
          return null;
        });
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [projectId, worktree.id, worktree.terminals, cols, reorderTerminal],
  );

  return (
    <div
      className="absolute"
      style={{
        left: worktree.position.x,
        top: worktree.position.y,
        width: computedSize.w,
        height: worktree.collapsed ? undefined : computedSize.h,
        minWidth: 300,
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
          style={{ minHeight: computedSize.h - WT_TITLE_H - WT_PAD }}
        >
          {worktree.terminals.map((terminal, index) => {
            // During drag, compute visual index considering the reorder preview
            let visualIndex = index;
            if (dragState) {
              const dragOrigIndex = worktree.terminals.findIndex(
                (t) => t.id === dragState.terminalId,
              );
              if (terminal.id === dragState.terminalId) {
                // Dragged terminal keeps its original grid position (offset applied via dragOffset props)
                visualIndex = dragOrigIndex;
              } else if (dragOrigIndex !== -1) {
                // Shift other terminals to preview the reorder
                if (dragOrigIndex < dragState.targetIndex) {
                  // Dragging forward: items between old and new shift back
                  if (index > dragOrigIndex && index <= dragState.targetIndex) {
                    visualIndex = index - 1;
                  }
                } else if (dragOrigIndex > dragState.targetIndex) {
                  // Dragging backward: items between new and old shift forward
                  if (index >= dragState.targetIndex && index < dragOrigIndex) {
                    visualIndex = index + 1;
                  }
                }
              }
            }

            const { x, y } = computeTerminalPosition(visualIndex, cols);
            const isDragging = dragState?.terminalId === terminal.id;

            return (
              <TerminalTile
                key={terminal.id}
                projectId={projectId}
                worktreeId={worktree.id}
                worktreePath={worktree.path}
                terminal={terminal}
                gridX={x}
                gridY={y}
                onDragStart={handleTerminalDragStart}
                isDragging={isDragging}
                dragOffsetX={isDragging ? dragState.offsetX : 0}
                dragOffsetY={isDragging ? dragState.offsetY : 0}
                onDoubleClick={() => handleZoomToFit(index)}
              />
            );
          })}
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

      {/* Diff card */}
      {showDiff && (
        <DiffCard
          worktreeId={worktree.id}
          worktreePath={worktree.path}
          anchorX={computedSize.w}
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
            x1={computedSize.w}
            y1={20}
            x2={computedSize.w + 16}
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
