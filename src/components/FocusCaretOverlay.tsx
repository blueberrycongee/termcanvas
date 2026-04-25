import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
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
        if (t.focused) return { x: t.x, y: t.y, w: t.width, h: t.height };
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
  const [, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Re-render on every frame while viewport is animating so the caret
  // stays pinned to the moving terminal.
  useEffect(() => {
    const loop = () => {
      setTick((v) => v + 1);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const pos = useMemo(() => findFocusedTerminal(projects), [projects]);

  const screenPos = useMemo(() => {
    if (!pos) return null;
    const sp = canvasPointToScreenPoint(
      pos.x + pos.w / 2,
      pos.y,
      viewport,
      leftPanelCollapsed,
      leftPanelWidth,
    );
    return { x: sp.x, y: sp.y };
  }, [pos, viewport, leftPanelCollapsed, leftPanelWidth]);

  if (!screenPos) return null;

  return createPortal(
    <div
      className="fixed pointer-events-none"
      style={{
        left: screenPos.x - CARET_W / 2,
        top: screenPos.y - CARET_H - CARET_OFFSET,
        zIndex: 100,
      }}
    >
      <svg width={CARET_W} height={CARET_H} viewBox="0 0 10 6" fill="none">
        <path d="M5 6L0 0h10L5 6z" fill="var(--text-secondary)" />
      </svg>
    </div>,
    document.body,
  );
}
