import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useInternalNode } from "@xyflow/react";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useTaskStore } from "../stores/taskStore";
import { canvasPointToScreenPoint } from "../canvas/viewportBounds";

const CARET_W = 10;
const CARET_H = 6;
const CARET_OFFSET = 4; // distance above tile top edge

function findFocusedTerminal(
  projects: ReturnType<typeof useProjectStore.getState>["projects"],
) {
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.focused)
          return { id: t.id, x: t.x, y: t.y, w: t.width, h: t.height };
      }
    }
  }
  return null;
}

export function FocusCaretOverlay() {
  const projects = useProjectStore((s) => s.projects);
  const viewport = useCanvasStore((s) => s.viewport);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const taskDrawerOpen = useTaskStore((s) => s.openProjectPath !== null);

  const pos = useMemo(() => findFocusedTerminal(projects), [projects]);
  // xyflow drives the tile via CSS transforms during drag and only commits
  // back to projectStore on drop. Subscribe to the live internal node so the
  // caret tracks each frame instead of jumping at release.
  const liveNode = useInternalNode(pos?.id ?? "");

  const screenPos = useMemo(() => {
    if (!pos) return null;
    const live = liveNode?.internals.positionAbsolute;
    const x = live?.x ?? pos.x;
    const y = live?.y ?? pos.y;
    const sp = canvasPointToScreenPoint(
      x + pos.w / 2,
      y,
      viewport,
      leftPanelCollapsed,
      leftPanelWidth,
      taskDrawerOpen,
    );
    return { x: sp.x, y: sp.y };
  }, [
    pos,
    liveNode,
    viewport,
    leftPanelCollapsed,
    leftPanelWidth,
    taskDrawerOpen,
  ]);

  if (!screenPos) return null;

  return createPortal(
    <div
      className="fixed pointer-events-none"
      style={{
        left: screenPos.x - CARET_W / 2,
        top: screenPos.y - CARET_H - CARET_OFFSET,
        zIndex: 30,
      }}
    >
      <svg width={CARET_W} height={CARET_H} viewBox="0 0 10 6" fill="none">
        <path d="M5 6L0 0h10L5 6z" fill="var(--text-secondary)" />
      </svg>
    </div>,
    document.body,
  );
}
