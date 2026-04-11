import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectData } from "../types";
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore } from "../stores/canvasStore";
import { canvasPointToScreenPoint } from "./viewportBounds";

/**
 * Per-worktree screen-space label layer.
 *
 * Renders one label per worktree, anchored to the topmost (min y, tiebreak
 * min x) live terminal in that worktree. Position follows the canvas pan/
 * zoom transform, but font size and padding are pixel-fixed so the label
 * stays readable at any scale — solving the "I can't tell which project
 * a tile belongs to once I zoom out" problem without resurrecting the old
 * project / worktree containers.
 *
 * The layer is purely a screen-space overlay: it never participates in
 * ReactFlow's node graph, never affects terminal positions, and is
 * pointer-events: none on the wrapper so it cannot block interactions.
 * Future tasks layer visibility rules, focus highlight, and interactivity
 * on top of this minimal placement.
 */

interface LabelEntry {
  key: string;
  projectId: string;
  worktreeId: string;
  projectName: string;
  worktreeName: string;
  worldX: number;
  worldY: number;
}

function buildLabels(projects: ProjectData[]): LabelEntry[] {
  const out: LabelEntry[] = [];
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      const tiles = worktree.terminals.filter(
        (t) => !t.stashed && !t.minimized,
      );
      if (tiles.length === 0) continue;
      let anchor = tiles[0];
      for (const t of tiles) {
        if (t.y < anchor.y || (t.y === anchor.y && t.x < anchor.x)) {
          anchor = t;
        }
      }
      out.push({
        key: `${project.id}::${worktree.id}`,
        projectId: project.id,
        worktreeId: worktree.id,
        projectName: project.name,
        worktreeName: worktree.name,
        worldX: anchor.x,
        worldY: anchor.y,
      });
    }
  }
  return out;
}

export function WorktreeLabelLayer() {
  const projects = useProjectStore((s) => s.projects);
  const viewport = useCanvasStore((s) => s.viewport);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const [, setResizeTick] = useState(0);

  useEffect(() => {
    const onResize = () => setResizeTick((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const labels = useMemo(() => buildLabels(projects), [projects]);

  if (typeof document === "undefined") return null;
  if (labels.length === 0) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: 30 }}
      aria-hidden="true"
    >
      {labels.map((label) => {
        const screen = canvasPointToScreenPoint(
          label.worldX,
          label.worldY,
          viewport,
          leftPanelCollapsed,
          leftPanelWidth,
        );
        return (
          <div
            key={label.key}
            className="absolute select-none whitespace-nowrap"
            style={{
              left: screen.x,
              top: screen.y,
              transform: "translate(0, calc(-100% - 6px))",
              fontFamily: '"Geist Mono", monospace',
              fontSize: 12,
              lineHeight: 1.2,
              color: "var(--text-primary)",
              padding: "2px 6px",
              backgroundColor:
                "color-mix(in srgb, var(--surface) 70%, transparent)",
              borderRadius: 4,
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
            }}
          >
            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
              {label.projectName}
            </span>
            <span style={{ color: "var(--text-faint)", margin: "0 4px" }}>
              /
            </span>
            <span style={{ fontWeight: 600 }}>{label.worktreeName}</span>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
