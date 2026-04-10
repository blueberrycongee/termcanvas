import { useCallback, useMemo } from "react";
import {
  type Node,
  type NodeProps,
  type NodeTypes,
  NodeResizer,
} from "@xyflow/react";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { TerminalTile } from "../terminal/TerminalTile";
import {
  resolveTerminalMountMode,
  shouldRenderTerminalTile,
} from "../terminal/terminalRuntimePolicy";
import { useTerminalRuntimeStore } from "../terminal/terminalRuntimeStore";
import { type TerminalNodeData, type CanvasFlowNode } from "./nodeProjection";
import { rectIntersectsCanvasViewport } from "./viewportBounds";
import { resolveCollisions } from "./collisionResolver";

const SNAP_GRID = 10;

function snapTo(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

type TerminalFlowNode = Node<TerminalNodeData, "terminal">;

function TerminalNode({ data, selected }: NodeProps<TerminalFlowNode>) {
  const viewport = useCanvasStore((state) => state.viewport);
  const rightPanelCollapsed = useCanvasStore(
    (state) => state.rightPanelCollapsed,
  );
  const leftPanelCollapsed = useCanvasStore(
    (state) => state.leftPanelCollapsed,
  );
  const leftPanelWidth = useCanvasStore((state) => state.leftPanelWidth);

  const terminal = useProjectStore(
    useCallback(
      (state) => {
        for (const p of state.projects) {
          if (p.id !== data.projectId) continue;
          for (const w of p.worktrees) {
            if (w.id !== data.worktreeId) continue;
            return w.terminals.find((t) => t.id === data.terminalId) ?? null;
          }
        }
        return null;
      },
      [data.projectId, data.worktreeId, data.terminalId],
    ),
  );

  const worktree = useProjectStore(
    useCallback(
      (state) => {
        const project = state.projects.find((p) => p.id === data.projectId);
        return project?.worktrees.find((w) => w.id === data.worktreeId) ?? null;
      },
      [data.projectId, data.worktreeId],
    ),
  );

  const updateTerminalSize = useProjectStore(
    (state) => state.updateTerminalSize,
  );

  const visible = useMemo(() => {
    if (!terminal) return false;
    return rectIntersectsCanvasViewport(
      { x: terminal.x, y: terminal.y, w: terminal.width, h: terminal.height },
      viewport,
      rightPanelCollapsed,
      leftPanelCollapsed,
      leftPanelWidth,
    );
  }, [
    terminal,
    viewport,
    rightPanelCollapsed,
    leftPanelCollapsed,
    leftPanelWidth,
  ]);

  const lodMode = useTerminalRuntimeStore(
    useCallback(
      (state) =>
        state.terminals[data.terminalId]?.mode ??
        resolveTerminalMountMode({
          focused: terminal?.focused ?? false,
          visible,
        }),
      [data.terminalId, terminal?.focused, visible],
    ),
  );

  const handleResizeEnd = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      const snappedW = snapTo(params.width, SNAP_GRID);
      const snappedH = snapTo(params.height, SNAP_GRID);
      updateTerminalSize(
        data.projectId,
        data.worktreeId,
        data.terminalId,
        snappedW,
        snappedH,
      );

      // Resolve collisions after resize
      const projects = useProjectStore.getState().projects;
      const allRects = projects.flatMap((p) =>
        p.worktrees.flatMap((w) =>
          w.terminals
            .filter((t) => !t.stashed)
            .map((t) => ({
              id: t.id,
              x: t.x,
              y: t.y,
              width: t.id === data.terminalId ? snappedW : t.width,
              height: t.id === data.terminalId ? snappedH : t.height,
            })),
        ),
      );
      const resolved = resolveCollisions(allRects, 10, data.terminalId);
      const updatePos = useProjectStore.getState().updateTerminalPosition;
      for (const rect of resolved) {
        if (rect.id === data.terminalId) continue;
        const original = allRects.find((r) => r.id === rect.id);
        if (original && (original.x !== rect.x || original.y !== rect.y)) {
          // Find which project/worktree owns this terminal
          for (const p of projects) {
            for (const w of p.worktrees) {
              if (w.terminals.some((t) => t.id === rect.id)) {
                updatePos(p.id, w.id, rect.id, rect.x, rect.y);
              }
            }
          }
        }
      }
    },
    [data.projectId, data.worktreeId, data.terminalId, updateTerminalSize],
  );

  if (!terminal || !worktree) {
    return null;
  }

  if (!shouldRenderTerminalTile({ focused: terminal.focused, visible })) {
    return null;
  }

  return (
    <div className="h-full w-full">
      <NodeResizer
        isVisible={selected ?? false}
        minWidth={300}
        minHeight={200}
        handleStyle={{ width: 8, height: 8 }}
        lineStyle={{ borderWidth: 1 }}
        onResizeEnd={handleResizeEnd}
      />
      <TerminalTile
        lodMode={lodMode}
        projectId={data.projectId}
        worktreeId={data.worktreeId}
        worktreeName={worktree.name}
        worktreePath={worktree.path}
        terminal={terminal}
        width={terminal.width}
        height={terminal.height}
      />
    </div>
  );
}

export const xyflowNodeTypes = {
  terminal: TerminalNode,
} satisfies NodeTypes;

export type { CanvasFlowNode, TerminalNodeData };
