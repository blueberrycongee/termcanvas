import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Position, WorktreeData } from "../types";
import {
  useProjectStore,
  createTerminal,
  getProjectBounds,
  stashTerminal,
} from "../stores/projectStore";
import { useCardLayoutStore } from "../stores/cardLayoutStore";
import { useSelectionStore } from "../stores/selectionStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { TERMINAL_TYPE_CONFIG } from "../terminal/terminalTypeConfig";
import { TerminalRuntimeHandle } from "../terminal/TerminalRuntimeHandle";
import {
  publishTerminalGeometry,
  unpublishTerminalGeometry,
} from "../terminal/terminalGeometryRegistry";
import { resolveTerminalMountMode } from "../terminal/terminalRuntimePolicy";
import { panToTerminal } from "../utils/panToTerminal";
import { useDrag } from "../hooks/useDrag";
import { FileCard } from "../components/FileCard";
import { useT } from "../i18n/useT";
import { useCanvasStore } from "../stores/canvasStore";
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";
import {
  packTerminals,
  getWorktreeSize,
  WT_PAD,
  WT_TITLE_H,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";

interface Props {
  projectId: string;
  projectCollapsed: boolean;
  worktree: WorktreeData;
  projectPosition: Position;
}

function rectIntersectsViewport(
  rect: { x: number; y: number; w: number; h: number },
  viewport: { x: number; y: number; scale: number },
) {
  const margin = 120;
  const left = -viewport.x / viewport.scale - margin;
  const top = -viewport.y / viewport.scale - margin;
  const right = left + window.innerWidth / viewport.scale + margin * 2;
  const bottom = top + window.innerHeight / viewport.scale + margin * 2;

  return (
    rect.x < right &&
    rect.x + rect.w > left &&
    rect.y < bottom &&
    rect.y + rect.h > top
  );
}

export function WorktreeContainer({
  projectId,
  projectCollapsed,
  worktree,
  projectPosition,
}: Props) {
  const t = useT();
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
  const viewport = useCanvasStore((s) => s.viewport);

  const isSelected = useSelectionStore((s) =>
    s.selectedItems.some(
      (item) =>
        item.type === "worktree" &&
        item.projectId === projectId &&
        item.worktreeId === worktree.id,
    ),
  );
  const selectWorktree = useSelectionStore((s) => s.selectWorktree);

  // Listen for close-card events (from batch delete)
  useEffect(() => {
    const handler = (e: Event) => {
      const { cardId } = (e as CustomEvent<{ cardId: string }>).detail;
      if (cardId.startsWith(`${worktree.id}-`)) {
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
  const stopHeaderButtonMouseDown = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);
  const stopHeaderButtonClick = useCallback(
    (event: React.MouseEvent, action: () => void) => {
      event.stopPropagation();
      action();
    },
    [],
  );

  const [dragState, setDragState] = useState<{
    terminalId: string;
    offsetX: number;
    offsetY: number;
    targetIndex: number;
    outsideWorktree?: boolean;
    ghostX?: number;
    ghostY?: number;
  } | null>(null);

  const tileW = useTileDimensionsStore((s) => s.w);
  const tileH = useTileDimensionsStore((s) => s.h);
  const tileDims = { w: tileW, h: tileH };
  const spans = worktree.terminals.map((t) => t.span);
  const packed = packTerminals(spans, undefined, tileDims);
  const computedSize = getWorktreeSize(spans, worktree.collapsed, undefined, tileDims);
  const terminalLayouts = useMemo(() => {
    return worktree.terminals.map((terminal, index) => {
      const item = packed[index];
      if (!item) {
        return null;
      }

      const absoluteRect = {
        h: item.h,
        w: item.w,
        x: projectPosition.x + PROJ_PAD + worktree.position.x + WT_PAD + item.x,
        y:
          projectPosition.y +
          PROJ_TITLE_H +
          PROJ_PAD +
          worktree.position.y +
          WT_TITLE_H +
          WT_PAD +
          item.y,
      };
      const visible =
        !projectCollapsed &&
        !worktree.collapsed &&
        rectIntersectsViewport(absoluteRect, viewport);

      return {
        absoluteRect,
        item,
        lodMode: resolveTerminalMountMode({
          focused: terminal.focused,
          visible,
        }),
        terminal,
      };
    });
  }, [
    packed,
    projectPosition.x,
    projectPosition.y,
    viewport,
    projectCollapsed,
    worktree.collapsed,
    worktree.position.x,
    worktree.position.y,
    worktree.terminals,
  ]);

  useEffect(() => {
    for (const layout of terminalLayouts) {
      if (!layout || (projectCollapsed || worktree.collapsed)) {
        continue;
      }

      publishTerminalGeometry({
        h: layout.absoluteRect.h,
        projectId,
        terminalId: layout.terminal.id,
        worktreeId: worktree.id,
        w: layout.absoluteRect.w,
        x: layout.absoluteRect.x,
        y: layout.absoluteRect.y,
      });
    }

    return () => {
      for (const terminal of worktree.terminals) {
        unpublishTerminalGeometry(terminal.id);
      }
    };
  }, [projectCollapsed, projectId, terminalLayouts, worktree.collapsed, worktree.id, worktree.terminals]);


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

      const contentH = computedSize.h - WT_TITLE_H;
      const contentW = computedSize.w;
      const packed = packTerminals(worktree.terminals.map((t) => t.span));
      const startItem = packed[origIndex];

      setDragState({
        terminalId,
        offsetX: 0,
        offsetY: 0,
        targetIndex: origIndex,
      });

      const handleMove = (ev: MouseEvent) => {
        const ox = (ev.clientX - startX) / scale;
        const oy = (ev.clientY - startY) / scale;

        if (!startItem) return;

        // Check if tile would leave content area → stash mode
        const tileTop = startItem.y + oy;
        const tileBottom = tileTop + startItem.h;
        const tileLeft = startItem.x + ox;
        const tileRight = tileLeft + startItem.w;

        const outside =
          tileTop < -8 ||
          tileBottom > contentH + 8 ||
          tileLeft < -8 ||
          tileRight > contentW + 8;

        if (outside) {
          setDragState((prev) =>
            prev
              ? { ...prev, offsetX: ox, offsetY: oy, outsideWorktree: true, ghostX: ev.clientX, ghostY: ev.clientY }
              : prev,
          );
          return;
        }

        // Normal reorder logic
        const currentPacked = packTerminals(worktree.terminals.map((t) => t.span));
        const origItem = currentPacked[origIndex];
        if (!origItem) return;

        const cx = origItem.x + ox + origItem.w / 2;
        const cy = origItem.y + oy + origItem.h / 2;

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
          outsideWorktree: false,
          ghostX: undefined,
          ghostY: undefined,
        });
      };

      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);

        setDragState((prev) => {
          if (prev?.outsideWorktree) {
            stashTerminal(projectId, worktree.id, terminalId);
            return null;
          }
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
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [projectId, worktree.id, worktree.terminals, reorderTerminal, computedSize],
  );


  return (
    <div
      className="absolute"
      style={{
        left: worktree.position.x,
        top: worktree.position.y,
        width: computedSize.w,
        height: computedSize.h,
        minWidth: 300,
        borderLeft: `2px solid ${focusedWorktreeId === worktree.id ? "var(--accent)" : "var(--border)"}`,
        outline: isSelected ? "2px solid var(--accent)" : undefined,
        outlineOffset: isSelected ? -2 : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        setFocusedWorktree(projectId, worktree.id);
        selectWorktree(projectId, worktree.id);
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
            onMouseDown={stopHeaderButtonMouseDown}
            onClick={(event) =>
              stopHeaderButtonClick(event, () =>
                toggleWorktreeCollapse(projectId, worktree.id),
              )
            }
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
            onMouseDown={stopHeaderButtonMouseDown}
            onClick={(event) => stopHeaderButtonClick(event, handleNewTerminal)}
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
            onMouseDown={stopHeaderButtonMouseDown}
            onClick={(event) =>
              stopHeaderButtonClick(event, () => {
                const term = createTerminal("lazygit", "lazygit");
                addTerminal(projectId, worktree.id, term);
              })
            }
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
      <div
        className="px-2 pb-2 relative"
        style={{
          height: worktree.collapsed ? 0 : computedSize.h - WT_TITLE_H,
          padding: worktree.collapsed ? 0 : undefined,
          overflow: "hidden",
        }}
      >
        {terminalLayouts.map((layout) => {
          if (!layout) {
            return null;
          }

          return (
            <TerminalRuntimeHandle
              key={`runtime:${layout.terminal.id}`}
              projectId={projectId}
              terminal={layout.terminal}
              worktreeId={worktree.id}
              worktreePath={worktree.path}
            />
          );
        })}
        {terminalLayouts.map((layout, index) => {
          if (!layout || layout.lodMode === "unmounted") return null;
          const { item, terminal } = layout;
          const isDragging = dragState?.terminalId === terminal.id;

          return (
            <TerminalTile
              key={terminal.id}
              lodMode={layout.lodMode}
              projectId={projectId}
              worktreeId={worktree.id}
              worktreeName={worktree.name}
              worktreePath={worktree.path}
              terminal={terminal}
              gridX={item.x + 8}
              gridY={item.y + 8}
              width={item.w}
              height={item.h}
              onDragStart={handleTerminalDragStart}
              isDragging={isDragging}
              isStashing={isDragging && !!dragState.outsideWorktree}
              dragOffsetX={isDragging ? dragState.offsetX : 0}
              dragOffsetY={isDragging ? dragState.offsetY : 0}
              onDoubleClick={() => panToTerminal(terminal.id)}
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
            {openFiles.map((file) => {
              return (
                <FileCard
                  key={file.id}
                  fileCardId={file.id}
                  filePath={file.filePath}
                  fileName={file.fileName}
                  anchorX={absX}
                  anchorY={absY}
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

      {dragState?.outsideWorktree && dragState.ghostX != null && (() => {
        const draggedTerminal = worktree.terminals.find((t) => t.id === dragState.terminalId);
        if (!draggedTerminal) return null;
        const cfg = TERMINAL_TYPE_CONFIG[draggedTerminal.type] ?? { color: "#888", label: draggedTerminal.type };
        return createPortal(
          <div
            className="pointer-events-none"
            style={{ position: "fixed", left: dragState.ghostX! - 20, top: dragState.ghostY! - 20, zIndex: 9999 }}
          >
            <div
              className="flex items-center gap-2 rounded-full px-4 py-2 shadow-2xl border-2"
              style={{
                background: "var(--surface)",
                borderColor: cfg.color,
                boxShadow: `0 0 24px ${cfg.color}50, 0 12px 40px rgba(0,0,0,0.4)`,
                fontFamily: '"Geist Mono", monospace',
              }}
            >
              <span className="w-3 h-3 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: cfg.color }} />
              <span className="text-[12px] font-semibold text-[var(--text-primary)] whitespace-nowrap">
                {draggedTerminal.customTitle || cfg.label}
              </span>
            </div>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
