import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import type { TerminalData } from "../types";
import { useProjectStore, createTerminal, stashTerminal } from "../stores/projectStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useNotificationStore } from "../stores/notificationStore";
import { TerminalTile } from "../terminal/TerminalTile";
import {
  resolveTerminalMountMode,
  shouldRenderTerminalTile,
} from "../terminal/terminalRuntimePolicy";
import { useTerminalRuntimeStore } from "../terminal/terminalRuntimeStore";
import { useT } from "../i18n/useT";
import { TERMINAL_TYPE_CONFIG } from "../terminal/terminalTypeConfig";
import {
  WT_PAD,
  WT_TITLE_H,
} from "../layout";
import { panToTerminal } from "../utils/panToTerminal";
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";
import {
  getRenderableTerminalLayouts,
  getRenderableTerminals,
  getRenderableWorktreeSize,
} from "./sceneState";
import {
  type ProjectNodeData,
  type WorktreeNodeData,
} from "./nodeProjection";
import { rectIntersectsCanvasViewport } from "./viewportBounds";
import { ContextMenu } from "../components/ContextMenu";

type ProjectFlowNode = Node<ProjectNodeData, "project">;
type WorktreeFlowNode = Node<WorktreeNodeData, "worktree">;

function NewWorktreePopover({
  x,
  y,
  onSubmit,
  onClose,
}: {
  x: number;
  y: number;
  onSubmit: (branch: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (busy) return;
    const branch = value.trim();
    if (!branch) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await onSubmit(branch);
      if (ok) {
        onClose();
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return createPortal(
    <div
      className="fixed z-[130] min-w-[220px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg"
      style={{ left: x, top: y }}
    >
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        placeholder="branch name"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="w-full text-[11px] px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] outline-none disabled:opacity-50"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      />
      {error && (
        <div className="mt-1 text-[10px] text-[var(--red)] truncate">{error}</div>
      )}
      <div className="mt-2 flex items-center justify-end gap-1">
        <button
          className="px-2 py-1 text-[10px] rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="px-2 py-1 text-[10px] rounded bg-[var(--accent)] text-[var(--bg)] hover:opacity-90 disabled:opacity-50"
          disabled={busy}
          onClick={() => void submit()}
        >
          Create
        </button>
      </div>
    </div>,
    document.body,
  );
}

function WorktreeTerminalItem({
  dragOffsetX,
  dragOffsetY,
  isDragging,
  isStashing,
  item,
  onDoubleClick,
  onDragStart,
  onSpanChange,
  projectId,
  terminal,
  visible,
  worktreeId,
  worktreeName,
  worktreePath,
}: {
  dragOffsetX: number;
  dragOffsetY: number;
  isDragging: boolean;
  isStashing: boolean;
  item: { h: number; w: number; x: number; y: number };
  onDoubleClick: () => void;
  onDragStart: (terminalId: string, event: React.MouseEvent) => void;
  onSpanChange: (span: { cols: number; rows: number }) => void;
  projectId: string;
  terminal: TerminalData;
  visible: boolean;
  worktreeId: string;
  worktreeName: string;
  worktreePath: string;
}) {
  const lodMode = useTerminalRuntimeStore(
    useCallback(
      (state) =>
        state.terminals[terminal.id]?.mode ??
        resolveTerminalMountMode({
          focused: terminal.focused,
          visible,
        }),
      [terminal.focused, terminal.id, visible],
    ),
  );

  if (!shouldRenderTerminalTile({ focused: terminal.focused, visible })) {
    return null;
  }

  return (
    <TerminalTile
      lodMode={lodMode}
      projectId={projectId}
      worktreeId={worktreeId}
      worktreeName={worktreeName}
      worktreePath={worktreePath}
      terminal={terminal}
      gridX={item.x + 8}
      gridY={item.y + 8}
      width={item.w}
      height={item.h}
      onDragStart={onDragStart}
      isDragging={isDragging}
      isStashing={isStashing}
      dragOffsetX={dragOffsetX}
      dragOffsetY={dragOffsetY}
      onDoubleClick={onDoubleClick}
      onSpanChange={onSpanChange}
    />
  );
}

function ProjectNode({ data }: NodeProps<ProjectFlowNode>) {
  const t = useT();
  const compactProjectWorktrees = useProjectStore(
    (state) => state.compactProjectWorktrees,
  );
  const syncWorktrees = useProjectStore((state) => state.syncWorktrees);
  const toggleProjectCollapse = useProjectStore(
    (state) => state.toggleProjectCollapse,
  );
  const removeProject = useProjectStore((state) => state.removeProject);
  const notify = useNotificationStore((state) => state.notify);
  const project = useProjectStore(
    useCallback(
      (state) =>
        state.projects.find((candidate) => candidate.id === data.projectId) ?? null,
      [data.projectId],
    ),
  );
  const isSelected = useSelectionStore((state) =>
    state.selectedItems.some(
      (item) => item.type === "project" && item.projectId === data.projectId,
    ),
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [createPopover, setCreatePopover] = useState<{
    x: number;
    y: number;
  } | null>(null);

  if (!project) {
    return null;
  }

  const handleCreateWorktree = async (branch: string): Promise<boolean> => {
    try {
      const result = await window.termcanvas.project.createWorktree(
        project.path,
        branch,
      );
      if (!result.ok) {
        notify("error", `Failed to create worktree: ${result.error}`);
        return false;
      }
      syncWorktrees(project.path, result.worktrees);
      notify("info", `Worktree "${branch}" created`);
      return true;
    } catch (err) {
      notify(
        "error",
        `Failed to create worktree: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  };

  return (
    <div
      className="panel nopan relative h-full w-full overflow-visible"
      style={{
        outline: isSelected ? "2px solid var(--accent)" : undefined,
        outlineOffset: isSelected ? -2 : undefined,
      }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[var(--radius)] bg-[var(--surface)]/80" />
      <div
        className="tc-project-drag-handle relative flex items-center gap-2 px-4 py-2 cursor-grab active:cursor-grabbing select-none"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <div
          className="absolute inset-0"
          onDoubleClick={() => toggleProjectCollapse(project.id)}
        />
        <span
          className="relative text-[11px] font-medium text-[var(--accent)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {t.project_label}
        </span>
        <span className="relative min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-primary)]">
          {project.name}
        </span>
        <div className="relative flex items-center gap-1">
          <button
            className="nodrag nopan text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={(event) => {
              event.stopPropagation();
              compactProjectWorktrees(project.id);
            }}
            title={t.project_compact}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect
                x="1.75"
                y="1.75"
                width="3"
                height="3"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.25"
              />
              <rect
                x="7.25"
                y="1.75"
                width="3"
                height="3"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.25"
              />
              <rect
                x="1.75"
                y="7.25"
                width="3"
                height="3"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.25"
              />
              <rect
                x="7.25"
                y="7.25"
                width="3"
                height="3"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.25"
              />
            </svg>
          </button>
          <button
            className="nodrag nopan text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={(event) => {
              event.stopPropagation();
              toggleProjectCollapse(project.id);
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              className={`transition-transform duration-150 ${project.collapsed ? "-rotate-90" : ""}`}
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
            className="nodrag nopan text-[var(--text-faint)] hover:text-[var(--red)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={(event) => {
              event.stopPropagation();
              removeProject(project.id);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3L9 9M9 3L3 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {!project.collapsed && (
        <div className="pointer-events-none px-3 pb-3">
          <div className="h-full rounded-[calc(var(--radius)-2px)] border border-dashed border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)]" />
        </div>
      )}

      {menu &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={[
              {
                label: "New Worktree...",
                onClick: () => {
                  if (!menu) return;
                  setCreatePopover({ x: menu.x + 4, y: menu.y + 4 });
                },
              },
            ]}
            onClose={() => setMenu(null)}
          />,
          document.body,
        )}

      {createPopover && (
        <NewWorktreePopover
          x={createPopover.x}
          y={createPopover.y}
          onSubmit={handleCreateWorktree}
          onClose={() => setCreatePopover(null)}
        />
      )}
    </div>
  );
}

function WorktreeNode({
  data,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps<WorktreeFlowNode>) {
  const t = useT();
  const focusedWorktreeId = useProjectStore((state) => state.focusedWorktreeId);
  const viewport = useCanvasStore((state) => state.viewport);
  const rightPanelCollapsed = useCanvasStore((state) => state.rightPanelCollapsed);
  const leftPanelCollapsed = useCanvasStore((state) => state.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((state) => state.leftPanelWidth);
  const toggleWorktreeCollapse = useProjectStore(
    (state) => state.toggleWorktreeCollapse,
  );
  const addTerminal = useProjectStore((state) => state.addTerminal);
  const syncWorktrees = useProjectStore((state) => state.syncWorktrees);
  const reorderTerminal = useProjectStore((state) => state.reorderTerminal);
  const updateTerminalSpan = useProjectStore(
    (state) => state.updateTerminalSpan,
  );
  const notify = useNotificationStore((state) => state.notify);
  const project = useProjectStore(
    useCallback(
      (state) =>
        state.projects.find((candidate) => candidate.id === data.projectId) ?? null,
      [data.projectId],
    ),
  );
  const worktree = useProjectStore(
    useCallback((state) => {
      const projectEntry = state.projects.find(
        (candidate) => candidate.id === data.projectId,
      );
      return (
        projectEntry?.worktrees.find(
          (candidate) => candidate.id === data.worktreeId,
        ) ?? null
      );
    }, [data.projectId, data.worktreeId]),
  );
  const isSelected = useSelectionStore((state) =>
    state.selectedItems.some(
      (item) =>
        item.type === "worktree" &&
        item.projectId === data.projectId &&
        item.worktreeId === data.worktreeId,
    ),
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [createPopover, setCreatePopover] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const tileW = useTileDimensionsStore((s) => s.w);
  const tileH = useTileDimensionsStore((s) => s.h);
  const tileDims = useMemo(() => ({ w: tileW, h: tileH }), [tileW, tileH]);
  const visibleTerminals = useMemo(
    () => (worktree ? getRenderableTerminals(worktree) : []),
    [worktree],
  );
  const packedLayouts = useMemo(
    () =>
      worktree
        ? getRenderableTerminalLayouts(worktree, undefined, tileDims)
        : [],
    [tileDims, worktree],
  );
  const computedSize = useMemo(
    () =>
      worktree
        ? getRenderableWorktreeSize(worktree, undefined, tileDims)
        : getRenderableWorktreeSize({
            collapsed: false,
            id: "",
            name: "",
            path: "",
            position: { x: 0, y: 0 },
            terminals: [],
          }),
    [tileDims, worktree],
  );

  const terminalLayouts = useMemo(() => {
    if (!worktree) {
      return [];
    }

    return packedLayouts.map((layout) => {
      const absoluteRect = {
        h: layout.item.h,
        w: layout.item.w,
        x: positionAbsoluteX + WT_PAD + layout.item.x,
        y: positionAbsoluteY + WT_TITLE_H + WT_PAD + layout.item.y,
      };
      const visible =
        !project?.collapsed &&
        !worktree.collapsed &&
        rectIntersectsCanvasViewport(
          absoluteRect,
          viewport,
          rightPanelCollapsed,
          leftPanelCollapsed,
          leftPanelWidth,
        );

      return {
        ...layout,
        visible,
      };
    });
  }, [
    leftPanelCollapsed,
    leftPanelWidth,
    packedLayouts,
    positionAbsoluteX,
    positionAbsoluteY,
    project?.collapsed,
    rightPanelCollapsed,
    viewport,
    worktree,
  ]);

  const handleNewTerminal = useCallback(() => {
    if (!worktree) {
      return;
    }

    addTerminal(data.projectId, worktree.id, createTerminal("shell"));
  }, [addTerminal, data.projectId, worktree]);

  const handleTerminalDragStart = useCallback(
    (terminalId: string, event: React.MouseEvent) => {
      if (!worktree) return;

      const originalIndex = visibleTerminals.findIndex(
        (terminal) => terminal.id === terminalId,
      );
      if (originalIndex === -1) return;

      event.preventDefault();
      event.stopPropagation();

      const scale = useCanvasStore.getState().viewport.scale;
      const startX = event.clientX;
      const startY = event.clientY;

      const contentH = computedSize.h - WT_TITLE_H;
      const contentW = computedSize.w;
      const startItem = packedLayouts[originalIndex]?.item;

      setDragState({
        terminalId,
        offsetX: 0,
        offsetY: 0,
        targetIndex: originalIndex,
      });

      const handleMove = (moveEvent: MouseEvent) => {
        const offsetX = (moveEvent.clientX - startX) / scale;
        const offsetY = (moveEvent.clientY - startY) / scale;

        if (!startItem) return;

        const tileTop = startItem.y + offsetY;
        const tileBottom = tileTop + startItem.h;
        const tileLeft = startItem.x + offsetX;
        const tileRight = tileLeft + startItem.w;

        const outside =
          tileTop < -8 ||
          tileBottom > contentH + 8 ||
          tileLeft < -8 ||
          tileRight > contentW + 8;

        if (outside) {
          setDragState((prev) =>
            prev
              ? { ...prev, offsetX, offsetY, outsideWorktree: true, ghostX: moveEvent.clientX, ghostY: moveEvent.clientY }
              : prev,
          );
          return;
        }

        const centerX = startItem.x + offsetX + startItem.w / 2;
        const centerY = startItem.y + offsetY + startItem.h / 2;

        let targetIndex = originalIndex;
        let minDistance = Infinity;

        for (const { item } of packedLayouts) {
          const itemCenterX = item.x + item.w / 2;
          const itemCenterY = item.y + item.h / 2;
          const distance =
            (centerX - itemCenterX) ** 2 + (centerY - itemCenterY) ** 2;

          if (distance < minDistance) {
            minDistance = distance;
            targetIndex = item.index;
          }
        }

        setDragState({
          terminalId,
          offsetX,
          offsetY,
          targetIndex,
          outsideWorktree: false,
          ghostX: undefined,
          ghostY: undefined,
        });
      };

      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);

        setDragState((previous) => {
          if (previous?.outsideWorktree) {
            stashTerminal(data.projectId, data.worktreeId, terminalId);
            return null;
          }

          if (previous && previous.targetIndex !== originalIndex) {
            reorderTerminal(
              data.projectId,
              data.worktreeId,
              previous.terminalId,
              previous.targetIndex,
            );
          }

          return null;
        });
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [
      computedSize,
      data.projectId,
      data.worktreeId,
      packedLayouts,
      reorderTerminal,
      visibleTerminals,
      worktree,
    ],
  );

  if (!project || !worktree) {
    return null;
  }

  const handleCreateWorktree = async (branch: string): Promise<boolean> => {
    try {
      const result = await window.termcanvas.project.createWorktree(
        project.path,
        branch,
      );
      if (!result.ok) {
        notify("error", `Failed to create worktree: ${result.error}`);
        return false;
      }
      syncWorktrees(project.path, result.worktrees);
      notify("info", `Worktree "${branch}" created`);
      return true;
    } catch (err) {
      notify(
        "error",
        `Failed to create worktree: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  };

  return (
    <div
      className="panel nopan h-full w-full overflow-hidden"
      style={{
        borderLeft: `2px solid ${
          focusedWorktreeId === worktree.id ? "var(--accent)" : "var(--border)"
        }`,
        outline: isSelected ? "2px solid var(--accent)" : undefined,
        outlineOffset: isSelected ? -2 : undefined,
      }}
    >
      <div
        className="tc-worktree-drag-handle flex items-center gap-2 px-3 py-2 select-none cursor-grab active:cursor-grabbing"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <span
          className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)] font-medium"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {worktree.name}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="nodrag nopan text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={(event) => {
              event.stopPropagation();
              toggleWorktreeCollapse(data.projectId, worktree.id);
            }}
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
            className="nodrag nopan text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={(event) => {
              event.stopPropagation();
              handleNewTerminal();
            }}
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
            className="nodrag nopan text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={(event) => {
              event.stopPropagation();
              addTerminal(
                data.projectId,
                worktree.id,
                createTerminal("lazygit", "lazygit"),
              );
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

      {menu &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={[
              {
                label: "New Worktree...",
                onClick: () => {
                  if (!menu) return;
                  setCreatePopover({ x: menu.x + 4, y: menu.y + 4 });
                },
              },
            ]}
            onClose={() => setMenu(null)}
          />,
          document.body,
        )}

      {createPopover && (
        <NewWorktreePopover
          x={createPopover.x}
          y={createPopover.y}
          onSubmit={handleCreateWorktree}
          onClose={() => setCreatePopover(null)}
        />
      )}

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

          if (
            !shouldRenderTerminalTile({
              focused: layout.terminal.focused,
              visible: layout.visible,
            })
          ) {
            return null;
          }

          const { item, terminal } = layout;
          const isDragging = dragState?.terminalId === terminal.id;

          return (
            <WorktreeTerminalItem
              key={terminal.id}
              projectId={data.projectId}
              worktreeId={worktree.id}
              worktreeName={worktree.name}
              worktreePath={worktree.path}
              terminal={terminal}
              visible={layout.visible}
              item={item}
              onDragStart={handleTerminalDragStart}
              isDragging={isDragging}
              isStashing={isDragging && !!dragState.outsideWorktree}
              dragOffsetX={isDragging ? dragState.offsetX : 0}
              dragOffsetY={isDragging ? dragState.offsetY : 0}
              onDoubleClick={() => panToTerminal(terminal.id)}
              onSpanChange={(span) =>
                updateTerminalSpan(data.projectId, worktree.id, terminal.id, span)
              }
            />
          );
        })}

        {visibleTerminals.length === 0 && !worktree.collapsed && (
          <button
            className="nodrag nopan w-full py-6 rounded-md text-[var(--text-faint)] text-[11px] hover:text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-colors duration-150"
            onClick={handleNewTerminal}
          >
            {t.new_terminal_btn}
          </button>
        )}
      </div>

      {dragState?.outsideWorktree && dragState.ghostX != null && (() => {
        const draggedTerminal = worktree.terminals.find((t) => t.id === dragState.terminalId);
        if (!draggedTerminal) return null;
        const cfg = TERMINAL_TYPE_CONFIG[draggedTerminal.type] ?? { color: "#888", label: draggedTerminal.type };
        return createPortal(
          <div
            className="pointer-events-none"
            style={{
              position: "fixed",
              left: dragState.ghostX! - 20,
              top: dragState.ghostY! - 20,
              zIndex: 9999,
            }}
          >
            <div
              className="flex items-center gap-2 rounded-full px-4 py-2 shadow-2xl border-2"
              style={{
                background: "var(--surface)",
                borderColor: cfg.color,
                boxShadow: `0 0 24px ${cfg.color}50, 0 12px 40px rgba(0,0,0,0.4)`,
                fontFamily: '"Geist Mono", monospace',
                transform: "scale(1.1)",
              }}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 animate-pulse"
                style={{ backgroundColor: cfg.color }}
              />
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

export const xyflowNodeTypes = {
  project: ProjectNode,
  worktree: WorktreeNode,
} satisfies NodeTypes;

export type CanvasFlowNode = ProjectFlowNode | WorktreeFlowNode;
export type { ProjectNodeData, WorktreeNodeData };
