import { useCallback, useMemo, useState } from "react";
import {
  type Node,
  type NodeProps,
  type NodeTypes,
  NodeResizer,
} from "@xyflow/react";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { TerminalTile } from "../terminal/TerminalTile";
import { resolveTerminalMountMode } from "../terminal/terminalRuntimePolicy";
import {
  fitTerminalRuntime,
  useTerminalRuntimeStore,
} from "../terminal/terminalRuntimeStore";
import { type TerminalNodeData, type CanvasFlowNode } from "./nodeProjection";
import { rectIntersectsCanvasViewport } from "./viewportBounds";
import { resolveCollisions } from "./collisionResolver";

const SNAP_GRID = 10;

function snapTo(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

type TerminalFlowNode = Node<TerminalNodeData, "terminal">;

function TerminalNode({ data }: NodeProps<TerminalFlowNode>) {
  const [hovered, setHovered] = useState(false);
  const viewport = useCanvasStore((state) => state.viewport);
  const rightPanelCollapsed = useCanvasStore(
    (state) => state.rightPanelCollapsed,
  );
  const leftPanelCollapsed = useCanvasStore(
    (state) => state.leftPanelCollapsed,
  );
  const leftPanelWidth = useCanvasStore((state) => state.leftPanelWidth);
  const rightPanelWidth = useCanvasStore((state) => state.rightPanelWidth);

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
  const updateTerminalPosition = useProjectStore(
    (state) => state.updateTerminalPosition,
  );

  const visible = useMemo(() => {
    if (!terminal) return false;
    return rectIntersectsCanvasViewport(
      { x: terminal.x, y: terminal.y, w: terminal.width, h: terminal.height },
      viewport,
      rightPanelCollapsed,
      leftPanelCollapsed,
      leftPanelWidth,
      rightPanelWidth,
    );
  }, [
    terminal,
    viewport,
    rightPanelCollapsed,
    leftPanelCollapsed,
    leftPanelWidth,
    rightPanelWidth,
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

  // Live resize: update the store on every frame so the inner TerminalTile
  // follows the React Flow wrapper while the user drags a handle.
  const handleResize = useCallback(
    (
      _event: unknown,
      params: { x: number; y: number; width: number; height: number },
    ) => {
      updateTerminalPosition(
        data.projectId,
        data.worktreeId,
        data.terminalId,
        params.x,
        params.y,
      );
      updateTerminalSize(
        data.projectId,
        data.worktreeId,
        data.terminalId,
        params.width,
        params.height,
      );
    },
    [
      data.projectId,
      data.worktreeId,
      data.terminalId,
      updateTerminalPosition,
      updateTerminalSize,
    ],
  );

  const handleResizeEnd = useCallback(
    (
      _event: unknown,
      params: { x: number; y: number; width: number; height: number },
    ) => {
      const snappedX = snapTo(params.x, SNAP_GRID);
      const snappedY = snapTo(params.y, SNAP_GRID);
      const snappedW = snapTo(params.width, SNAP_GRID);
      const snappedH = snapTo(params.height, SNAP_GRID);
      updateTerminalPosition(
        data.projectId,
        data.worktreeId,
        data.terminalId,
        snappedX,
        snappedY,
      );
      updateTerminalSize(
        data.projectId,
        data.worktreeId,
        data.terminalId,
        snappedW,
        snappedH,
      );

      // Remember this as the user's preferred size for future new
      // terminals. Sanitizer in preferencesStore rejects implausible
      // values (e.g. near-zero), so we can write unconditionally here
      // and not worry about corrupting the pref from an accidental
      // zero-sized resize.
      usePreferencesStore
        .getState()
        .setDefaultTerminalSize({ w: snappedW, h: snappedH });

      // Resolve collisions after resize
      const projects = useProjectStore.getState().projects;
      const allRects = projects.flatMap((p) =>
        p.worktrees.flatMap((w) =>
          w.terminals
            .filter((t) => !t.stashed)
            .map((t) => ({
              id: t.id,
              x: t.id === data.terminalId ? snappedX : t.x,
              y: t.id === data.terminalId ? snappedY : t.y,
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

      // Explicitly refit xterm once the drag settles. TerminalTile also has a
      // width/height effect that refits, but calling it here guarantees fit
      // runs against the final DOM size even if the effect races with the
      // React Flow dimension sync.
      requestAnimationFrame(() => {
        fitTerminalRuntime(data.terminalId);
      });
    },
    [
      data.projectId,
      data.worktreeId,
      data.terminalId,
      updateTerminalPosition,
      updateTerminalSize,
    ],
  );

  if (!terminal || !worktree) {
    return null;
  }

  return (
    <div
      className="h-full w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <NodeResizer
        isVisible={hovered}
        minWidth={300}
        minHeight={200}
        handleStyle={{
          width: 8,
          height: 8,
          background: "var(--surface)",
          borderColor: "var(--border-hover)",
        }}
        lineStyle={{
          borderWidth: 1,
          borderColor: "var(--border-hover)",
        }}
        onResize={handleResize}
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
