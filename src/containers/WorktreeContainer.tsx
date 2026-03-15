import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Position, WorktreeData } from "../types";
import {
  useProjectStore,
  createTerminal,
  getProjectBounds,
} from "../stores/projectStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { useDrag } from "../hooks/useDrag";
import { DiffCard } from "../components/DiffCard";
import { useT } from "../i18n/useT";
import { useCanvasStore } from "../stores/canvasStore";
import {
  packTerminals,
  computeWorktreeSize,
  WT_PAD,
  WT_TITLE_H,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";

interface Props {
  projectId: string;
  worktree: WorktreeData;
  projectPosition: Position;
}

export function WorktreeContainer({
  projectId,
  worktree,
  projectPosition,
}: Props) {
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
    setFocusedWorktree,
    focusedWorktreeId,
    updateTerminalSpan,
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

  const spans = worktree.terminals.map((t) => t.span);
  const packed = packTerminals(spans);
  const computedSize = computeWorktreeSize(spans);

  const handleZoomToFit = useCallback(
    (index: number) => {
      const project = useProjectStore
        .getState()
        .projects.find((p) => p.id === projectId);
      if (!project) return;
      const wt = project.worktrees.find((w) => w.id === worktree.id);
      if (!wt) return;
      const currentPacked = packTerminals(wt.terminals.map((t) => t.span));
      const item = currentPacked[index];
      if (!item) return;

      const absX =
        project.position.x + PROJ_PAD + worktree.position.x + WT_PAD + item.x;
      const absY =
        project.position.y +
        PROJ_TITLE_H +
        PROJ_PAD +
        worktree.position.y +
        WT_TITLE_H +
        WT_PAD +
        item.y;

      const padding = 60;
      const viewW = window.innerWidth - padding * 2;
      const viewH = window.innerHeight - padding * 2;
      const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

      const centerX = -(absX + item.w / 2) * scale + window.innerWidth / 2;
      const centerY = -(absY + item.h / 2) * scale + window.innerHeight / 2;

      useCanvasStore.getState().animateTo(centerX, centerY, scale);
    },
    [projectId, worktree.id, worktree.position],
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

        // Use current packed layout for hit testing
        const currentSpans = worktree.terminals.map((t) => t.span);
        const currentPacked = packTerminals(currentSpans);
        const origItem = currentPacked[origIndex];
        if (!origItem) return;

        const cx = origItem.x + ox + origItem.w / 2;
        const cy = origItem.y + oy + origItem.h / 2;

        // Find closest packed item by center distance
        let targetIndex = origIndex;
        let minDist = Infinity;
        for (const p of currentPacked) {
          const px = p.x + p.w / 2;
          const py = p.y + p.h / 2;
          const dist = (cx - px) ** 2 + (cy - py) ** 2;
          if (dist < minDist) {
            minDist = dist;
            targetIndex = p.index;
          }
        }

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
    [projectId, worktree.id, worktree.terminals, reorderTerminal],
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
        borderLeft: `2px solid ${focusedWorktreeId === worktree.id ? "var(--accent)" : "var(--border)"}`,
      }}
      onClick={() => setFocusedWorktree(projectId, worktree.id)}
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
      <div
        className="px-2 pb-2 relative overflow-hidden"
        style={{
          height: worktree.collapsed ? 0 : computedSize.h - WT_TITLE_H,
          padding: worktree.collapsed ? 0 : undefined,
          overflow: "hidden",
        }}
      >
        {worktree.terminals.map((terminal, index) => {
          const item = packed[index];
          if (!item) return null;
          const isDragging = dragState?.terminalId === terminal.id;

          return (
            <TerminalTile
              key={terminal.id}
              projectId={projectId}
              worktreeId={worktree.id}
              worktreePath={worktree.path}
              terminal={terminal}
              gridX={item.x}
              gridY={item.y}
              width={item.w}
              height={item.h}
              onDragStart={handleTerminalDragStart}
              isDragging={isDragging}
              dragOffsetX={isDragging ? dragState.offsetX : 0}
              dragOffsetY={isDragging ? dragState.offsetY : 0}
              onDoubleClick={() => handleZoomToFit(index)}
              onSpanChange={(span) =>
                updateTerminalSpan(projectId, worktree.id, terminal.id, span)
              }
            />
          );
        })}
        {worktree.terminals.length === 0 && !worktree.collapsed && (
          <button
            className="w-full py-6 rounded-md text-[var(--text-faint)] text-[11px] hover:text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-colors duration-150"
            onClick={handleNewTerminal}
          >
            {t.new_terminal_btn}
          </button>
        )}
      </div>

      {/* Diff card — portaled to canvas layer so it's never clipped by containers */}
      {showDiff &&
        (() => {
          const portalTarget = document.getElementById("canvas-layer");
          if (!portalTarget) return null;
          const project = useProjectStore
            .getState()
            .projects.find((p) => p.id === projectId);
          const projectW = project
            ? getProjectBounds(project).w
            : PROJ_PAD + worktree.position.x + computedSize.w;
          const absX = projectPosition.x + projectW;
          const absY = projectPosition.y + PROJ_TITLE_H + worktree.position.y;
          return createPortal(
            <>
              <DiffCard
                projectId={projectId}
                worktreeId={worktree.id}
                worktreePath={worktree.path}
                anchorX={absX}
                anchorY={absY}
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
                    leaveTimeout.current = setTimeout(
                      () => setShowDiff(false),
                      300,
                    );
                  }
                }}
              />
            </>,
            portalTarget,
          );
        })()}
    </div>
  );
}
