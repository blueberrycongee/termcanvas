import { useCallback, useMemo, useState } from "react";
import {
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import type { TerminalData } from "../types";
import { useProjectStore, createTerminal } from "../stores/projectStore";
import { useSelectionStore } from "../stores/selectionStore";
import { useCanvasStore } from "../stores/canvasStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { resolveTerminalMountMode } from "../terminal/terminalRuntimePolicy";
import { useTerminalRuntimeStore } from "../terminal/terminalRuntimeStore";
import { useT } from "../i18n/useT";
import {
  packTerminals,
  getWorktreeSize,
  WT_TITLE_H,
} from "../layout";
import { panToTerminal } from "../utils/panToTerminal";
import {
  type ProjectNodeData,
  type WorktreeNodeData,
} from "./nodeProjection";

type ProjectFlowNode = Node<ProjectNodeData, "project">;
type WorktreeFlowNode = Node<WorktreeNodeData, "worktree">;

function WorktreeTerminalItem({
  dragOffsetX,
  dragOffsetY,
  isDragging,
  item,
  onDoubleClick,
  onDragStart,
  onSpanChange,
  projectId,
  terminal,
  worktreeId,
  worktreePath,
}: {
  dragOffsetX: number;
  dragOffsetY: number;
  isDragging: boolean;
  item: { h: number; w: number; x: number; y: number };
  onDoubleClick: () => void;
  onDragStart: (terminalId: string, event: React.MouseEvent) => void;
  onSpanChange: (span: { cols: number; rows: number }) => void;
  projectId: string;
  terminal: TerminalData;
  worktreeId: string;
  worktreePath: string;
}) {
  const lodMode = useTerminalRuntimeStore(
    useCallback(
      (state) =>
        state.terminals[terminal.id]?.mode ??
        resolveTerminalMountMode({
          focused: terminal.focused,
          visible: true,
        }),
      [terminal.focused, terminal.id],
    ),
  );

  if (lodMode === "unmounted") {
    return null;
  }

  return (
    <TerminalTile
      lodMode={lodMode}
      projectId={projectId}
      worktreeId={worktreeId}
      worktreePath={worktreePath}
      terminal={terminal}
      gridX={item.x + 8}
      gridY={item.y + 8}
      width={item.w}
      height={item.h}
      onDragStart={onDragStart}
      isDragging={isDragging}
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
  const toggleProjectCollapse = useProjectStore(
    (state) => state.toggleProjectCollapse,
  );
  const removeProject = useProjectStore((state) => state.removeProject);
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

  if (!project) {
    return null;
  }

  return (
    <div
      className="panel nopan relative h-full w-full overflow-visible"
      style={{
        outline: isSelected ? "2px solid var(--accent)" : undefined,
        outlineOffset: isSelected ? -2 : undefined,
      }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[var(--radius)] bg-[var(--surface)]/80" />
      <div className="tc-project-drag-handle relative flex items-center gap-2 px-4 py-2 cursor-grab active:cursor-grabbing select-none">
        <span
          className="text-[11px] font-medium text-[var(--accent)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {t.project_label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-primary)]">
          {project.name}
        </span>
        <div className="flex items-center gap-1">
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
    </div>
  );
}

function WorktreeNode({ data }: NodeProps<WorktreeFlowNode>) {
  const t = useT();
  const focusedWorktreeId = useProjectStore((state) => state.focusedWorktreeId);
  const toggleWorktreeCollapse = useProjectStore(
    (state) => state.toggleWorktreeCollapse,
  );
  const addTerminal = useProjectStore((state) => state.addTerminal);
  const reorderTerminal = useProjectStore((state) => state.reorderTerminal);
  const updateTerminalSpan = useProjectStore(
    (state) => state.updateTerminalSpan,
  );
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
  } | null>(null);

  const spans = useMemo(
    () => worktree?.terminals.map((terminal) => terminal.span) ?? [],
    [worktree],
  );
  const packed = useMemo(() => packTerminals(spans), [spans]);
  const computedSize = useMemo(
    () => getWorktreeSize(spans, worktree?.collapsed ?? false),
    [spans, worktree?.collapsed],
  );
  const terminalLayouts = useMemo(() => {
    if (!worktree) {
      return [];
    }

    return worktree.terminals.map((terminal, index) => {
      const item = packed[index];
      if (!item) {
        return null;
      }

      return {
        item,
        terminal,
      };
    });
  }, [packed, worktree]);

  const handleNewTerminal = useCallback(() => {
    if (!worktree) {
      return;
    }

    addTerminal(data.projectId, worktree.id, createTerminal("shell"));
  }, [addTerminal, data.projectId, worktree]);

  const handleTerminalDragStart = useCallback(
    (terminalId: string, event: React.MouseEvent) => {
      if (!worktree) {
        return;
      }

      const originalIndex = worktree.terminals.findIndex(
        (terminal) => terminal.id === terminalId,
      );
      if (originalIndex === -1) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const scale = useCanvasStore.getState().viewport.scale;
      const startX = event.clientX;
      const startY = event.clientY;

      setDragState({
        terminalId,
        offsetX: 0,
        offsetY: 0,
        targetIndex: originalIndex,
      });

      const handleMove = (moveEvent: MouseEvent) => {
        const offsetX = (moveEvent.clientX - startX) / scale;
        const offsetY = (moveEvent.clientY - startY) / scale;
        const currentPacked = packTerminals(
          worktree.terminals.map((terminal) => terminal.span),
        );
        const originalItem = currentPacked[originalIndex];

        if (!originalItem) {
          return;
        }

        const centerX = originalItem.x + offsetX + originalItem.w / 2;
        const centerY = originalItem.y + offsetY + originalItem.h / 2;

        let targetIndex = originalIndex;
        let minDistance = Infinity;

        for (const item of currentPacked) {
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
        });
      };

      const handleUp = () => {
        setDragState((previous) => {
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

        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [data.projectId, data.worktreeId, reorderTerminal, worktree],
  );

  if (!project || !worktree) {
    return null;
  }

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
      <div className="tc-worktree-drag-handle flex items-center gap-2 px-3 py-2 select-none cursor-grab active:cursor-grabbing">
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

      <div
        className="px-2 pb-2 relative"
        style={{
          height: worktree.collapsed ? 0 : computedSize.h - WT_TITLE_H,
          padding: worktree.collapsed ? 0 : undefined,
          overflow: worktree.terminals.some((t) => t.focused) ? "visible" : "hidden",
        }}
      >
        {terminalLayouts.map((layout) => {
          if (!layout) {
            return null;
          }

          const { item, terminal } = layout;
          const isDragging = dragState?.terminalId === terminal.id;

          return (
            <WorktreeTerminalItem
              key={terminal.id}
              projectId={data.projectId}
              worktreeId={worktree.id}
              worktreePath={worktree.path}
              terminal={terminal}
              item={item}
              onDragStart={handleTerminalDragStart}
              isDragging={isDragging}
              dragOffsetX={isDragging ? dragState.offsetX : 0}
              dragOffsetY={isDragging ? dragState.offsetY : 0}
              onDoubleClick={() => panToTerminal(terminal.id)}
              onSpanChange={(span) =>
                updateTerminalSpan(data.projectId, worktree.id, terminal.id, span)
              }
            />
          );
        })}

        {worktree.terminals.length === 0 && !worktree.collapsed && (
          <button
            className="nodrag nopan w-full py-6 rounded-md text-[var(--text-faint)] text-[11px] hover:text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-colors duration-150"
            onClick={handleNewTerminal}
          >
            {t.new_terminal_btn}
          </button>
        )}
      </div>
    </div>
  );
}

export const xyflowNodeTypes = {
  project: ProjectNode,
  worktree: WorktreeNode,
} satisfies NodeTypes;

export type CanvasFlowNode = ProjectFlowNode | WorktreeFlowNode;
export type { ProjectNodeData, WorktreeNodeData };
