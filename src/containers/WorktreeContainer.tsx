import { Profiler, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Position, WorktreeData } from "../types";
import {
  useProjectStore,
  createTerminal,
  getProjectBounds,
} from "../stores/projectStore";
import { useCardLayoutStore } from "../stores/cardLayoutStore";
import { useSelectionStore } from "../stores/selectionStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { useDrag } from "../hooks/useDrag";
import { DiffCard } from "../components/DiffCard";
import { FileTreeCard } from "../components/FileTreeCard";
import { FileCard } from "../components/FileCard";
import {
  clearHoverCardHideTimeout,
  createHoverCardVisibilityState,
  scheduleHoverCardHide,
} from "../components/hoverCardVisibility";
import { useT } from "../i18n/useT";
import { useCanvasStore, RIGHT_PANEL_WIDTH, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import {
  packTerminals,
  computeWorktreeSize,
  WT_PAD,
  WT_TITLE_H,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";
import { logFocusProfiler } from "../utils/focusPerf";

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
  const diffLeaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diffCardHovered = useRef(false);
  const diffPinnedRef = useRef(diffPinned);
  const diffCardDragging = useRef(false);

  const [showFileTree, setShowFileTree] = useState(false);
  const [fileTreePinned, setFileTreePinned] = useState(false);
  const fileTreeLeaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileTreeCardHovered = useRef(false);
  const fileTreePinnedRef = useRef(fileTreePinned);
  const fileTreeCardDragging = useRef(false);

  const [openFiles, setOpenFiles] = useState<
    { id: string; filePath: string; fileName: string }[]
  >([]);
  const {
    toggleWorktreeCollapse,
    addTerminal,
    updateWorktreePosition,
    reorderTerminal,
    setFocusedWorktree,
    focusedWorktreeId,
    updateTerminalSpan,
  } = useProjectStore();
  const allCards = useCardLayoutStore((s) => s.cards);

  const isSelected = useSelectionStore((s) =>
    s.selectedItems.some(
      (item) =>
        item.type === "worktree" &&
        item.projectId === projectId &&
        item.worktreeId === worktree.id,
    ),
  );

  // Listen for close-card events (from batch delete)
  useEffect(() => {
    const handler = (e: Event) => {
      const { cardId } = (e as CustomEvent<{ cardId: string }>).detail;
      // Check if this card belongs to this worktree
      const diffId = `diff:${worktree.id}`;
      const fileTreeId = `filetree:${worktree.id}`;
      if (cardId === diffId) {
        setDiffPinned(false);
        setShowDiff(false);
      } else if (cardId === fileTreeId) {
        setFileTreePinned(false);
        setShowFileTree(false);
      } else if (cardId.startsWith(`${worktree.id}-`)) {
        // FileCard id pattern: worktreeId-timestamp
        setOpenFiles((prev) => prev.filter((f) => f.id !== cardId));
      }
    };
    window.addEventListener("termcanvas:close-card", handler);
    return () => window.removeEventListener("termcanvas:close-card", handler);
  }, [worktree.id]);

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

      const { rightPanelCollapsed } = useCanvasStore.getState();
      const rightOffset = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;
      const padding = 60;
      const viewW = window.innerWidth - rightOffset - padding * 2;
      const viewH = window.innerHeight - padding * 2;
      const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

      const centerX = -(absX + item.w / 2) * scale + (window.innerWidth - rightOffset) / 2;
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

  diffPinnedRef.current = diffPinned;
  fileTreePinnedRef.current = fileTreePinned;
  const anyHoverCardDragging = useCallback(
    () => diffCardDragging.current || fileTreeCardDragging.current,
    [],
  );

  const scheduleDiffHide = useCallback(() => {
    scheduleHoverCardHide(
      diffLeaveTimeout,
      () =>
        createHoverCardVisibilityState({
          pinned: diffPinnedRef.current,
          hovered: diffCardHovered.current,
          draggingSelf: diffCardDragging.current,
          draggingRelated: fileTreeCardDragging.current,
        }),
      () => setShowDiff(false),
    );
  }, []);

  const scheduleFileTreeHide = useCallback(() => {
    scheduleHoverCardHide(
      fileTreeLeaveTimeout,
      () =>
        createHoverCardVisibilityState({
          pinned: fileTreePinnedRef.current,
          hovered: fileTreeCardHovered.current,
          draggingSelf: fileTreeCardDragging.current,
          draggingRelated: diffCardDragging.current,
        }),
      () => setShowFileTree(false),
    );
  }, []);

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
        outline: isSelected ? "2px solid #3b82f6" : undefined,
        outlineOffset: isSelected ? -2 : undefined,
      }}
      onClick={() => setFocusedWorktree(projectId, worktree.id)}
      onMouseEnter={() => {
        clearHoverCardHideTimeout(diffLeaveTimeout);
        clearHoverCardHideTimeout(fileTreeLeaveTimeout);
        if (!diffPinned || !fileTreePinned) {
          hoverTimeout.current = setTimeout(() => {
            if (!diffPinned) setShowDiff(true);
            if (!fileTreePinned) setShowFileTree(true);
          }, 400);
        }
      }}
      onMouseLeave={() => {
        if (hoverTimeout.current) {
          clearTimeout(hoverTimeout.current);
          hoverTimeout.current = null;
        }
        if (!diffPinned) {
          scheduleDiffHide();
        }
        if (!fileTreePinned) {
          scheduleFileTreeHide();
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
          <button
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={() => {
              const term = createTerminal("lazygit", "lazygit");
              addTerminal(projectId, worktree.id, term);
            }}
            title={t.lazygit}
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <path
                d="M9.5 3.5L8 2L6.5 3.5M8 2v8M4 7l-2 2 2 2M12 7l2 2-2 2M5 14h6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminals */}
      <Profiler
        id={`WorktreeContainer:${worktree.id}`}
        onRender={(_id, phase, actualDuration) => {
          logFocusProfiler("WorktreeContainer", phase, actualDuration, {
            thresholdMs: 3,
            details: {
              projectId,
              worktreeId: worktree.id,
              terminals: worktree.terminals.length,
            },
          });
        }}
      >
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
      </Profiler>

      {/* Cards — portaled to canvas layer so they're never clipped by containers */}
      {(() => {
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
            {showDiff && (
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
                  clearHoverCardHideTimeout(diffLeaveTimeout);
                }}
                onMouseLeave={() => {
                  diffCardHovered.current = false;
                  if (!diffPinned) {
                    scheduleDiffHide();
                  }
                }}
                onDragStateChange={(dragging) => {
                  diffCardDragging.current = dragging;
                  if (dragging) {
                    clearHoverCardHideTimeout(diffLeaveTimeout);
                    clearHoverCardHideTimeout(fileTreeLeaveTimeout);
                    return;
                  }
                  if (!anyHoverCardDragging()) {
                    if (!diffPinnedRef.current && !diffCardHovered.current) {
                      scheduleDiffHide();
                    }
                    if (
                      !fileTreePinnedRef.current &&
                      !fileTreeCardHovered.current
                    ) {
                      scheduleFileTreeHide();
                    }
                  }
                }}
              />
            )}
            {showFileTree && (
              <FileTreeCard
                projectId={projectId}
                worktreeId={worktree.id}
                worktreePath={worktree.path}
                anchorX={absX}
                anchorY={absY}
                pinned={fileTreePinned}
                onPin={() => setFileTreePinned(true)}
                onClose={() => {
                  setFileTreePinned(false);
                  setShowFileTree(false);
                }}
                onMouseEnter={() => {
                  fileTreeCardHovered.current = true;
                  clearHoverCardHideTimeout(fileTreeLeaveTimeout);
                }}
                onMouseLeave={() => {
                  fileTreeCardHovered.current = false;
                  if (!fileTreePinned) {
                    scheduleFileTreeHide();
                  }
                }}
                onDragStateChange={(dragging) => {
                  fileTreeCardDragging.current = dragging;
                  if (dragging) {
                    clearHoverCardHideTimeout(diffLeaveTimeout);
                    clearHoverCardHideTimeout(fileTreeLeaveTimeout);
                    return;
                  }
                  if (!anyHoverCardDragging()) {
                    if (!diffPinnedRef.current && !diffCardHovered.current) {
                      scheduleDiffHide();
                    }
                    if (
                      !fileTreePinnedRef.current &&
                      !fileTreeCardHovered.current
                    ) {
                      scheduleFileTreeHide();
                    }
                  }
                }}
                onOpenFile={(filePath, fileName) => {
                  setOpenFiles((prev) => {
                    if (prev.some((f) => f.filePath === filePath)) return prev;
                    return [
                      ...prev,
                      { id: `${worktree.id}-${Date.now()}`, filePath, fileName },
                    ];
                  });
                }}
              />
            )}
            {openFiles.map((file) => {
              // Anchor to FileTreeCard resolved position right edge, fallback to worktree anchor
              const fileTreeCardId = `filetree:${worktree.id}`;
              const ftCard = allCards[fileTreeCardId];
              const fileAnchorX = ftCard ? ftCard.x + ftCard.w : absX;
              const fileAnchorY = ftCard ? ftCard.y : absY;
              return (
                <FileCard
                  key={file.id}
                  fileCardId={file.id}
                  filePath={file.filePath}
                  fileName={file.fileName}
                  anchorX={fileAnchorX}
                  anchorY={fileAnchorY}
                  onClose={() =>
                    setOpenFiles((prev) =>
                      prev.filter((f) => f.id !== file.id),
                    )
                  }
                />
              );
            })}
          </>,
          portalTarget,
        );
      })()}
    </div>
  );
}
