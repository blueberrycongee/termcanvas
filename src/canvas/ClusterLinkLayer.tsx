import { useEffect, useMemo, useState } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import type { ProjectData } from "../types";

/**
 * "Map mode" cluster visualization.
 *
 * The canvas already encodes terminal relationships (parentTerminalId,
 * project / worktree grouping) but the screen never makes them visible.
 * Once you've zoomed out far enough that you can no longer read terminal
 * contents, this layer fades in hairline curves between parent ↔ child
 * agents, so the canvas turns into a visible graph of work.
 *
 * Hovering any tile additionally outlines its whole agent family — root +
 * descendants — so a single hover answers "what else belongs to this
 * thread of work?".
 *
 * The layer is purely visual. It owns no relationship state, listens to
 * the existing termcanvas:terminal-hover event for hover, and is fully
 * pointer-events: none so it never blocks interaction.
 */

const ZOOM_THRESHOLD = 0.6;
// Ramp the layer in across the band [THRESHOLD - BAND, THRESHOLD] so
// the cue arrives gradually as the user zooms out, not as a hard pop.
const FADE_BAND = 0.1;
const OUTLINE_PADDING = 4;
const OUTLINE_RADIUS = 6;

interface TerminalRect {
  id: string;
  projectId: string;
  worktreeId: string;
  parentId: string | undefined;
  cx: number;
  cy: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FamilyEdge {
  id: string;
  parentId: string;
  childId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function collectTerminals(projects: ProjectData[]): TerminalRect[] {
  const out: TerminalRect[] = [];
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) continue;
        out.push({
          id: terminal.id,
          projectId: project.id,
          worktreeId: worktree.id,
          parentId: terminal.parentTerminalId,
          x: terminal.x,
          y: terminal.y,
          w: terminal.width,
          h: terminal.height,
          cx: terminal.x + terminal.width / 2,
          cy: terminal.y + terminal.height / 2,
        });
      }
    }
  }
  return out;
}

function buildParentChildEdges(rects: TerminalRect[]): FamilyEdge[] {
  const byId = new Map(rects.map((r) => [r.id, r]));
  const edges: FamilyEdge[] = [];
  for (const r of rects) {
    if (!r.parentId) continue;
    const parent = byId.get(r.parentId);
    if (!parent) continue;
    if (parent.projectId !== r.projectId) continue;
    edges.push({
      id: `${parent.id}->${r.id}`,
      parentId: parent.id,
      childId: r.id,
      x1: parent.cx,
      y1: parent.cy,
      x2: r.cx,
      y2: r.cy,
    });
  }
  return edges;
}

function getFamilyIds(
  rects: TerminalRect[],
  terminalId: string | null,
): Set<string> {
  if (!terminalId) return new Set();
  const byId = new Map(rects.map((r) => [r.id, r]));
  if (!byId.has(terminalId)) return new Set();

  let rootId = terminalId;
  for (let i = 0; i < 32; i++) {
    const t = byId.get(rootId);
    if (!t?.parentId) break;
    if (!byId.has(t.parentId)) break;
    rootId = t.parentId;
  }

  const family = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const r of rects) {
      if (r.parentId === id && !family.has(r.id)) {
        family.add(r.id);
        queue.push(r.id);
      }
    }
  }
  return family;
}

function curvedPath(edge: FamilyEdge): string {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const len = Math.hypot(dx, dy) || 1;
  // Pull the control point off the chord so the line reads as a soft
  // connection rather than a ruler. Cap the offset so long edges across
  // the canvas don't bow into a giant arc.
  const offset = Math.min(80, len * 0.18);
  const midX = (edge.x1 + edge.x2) / 2;
  const midY = (edge.y1 + edge.y2) / 2;
  const cx = midX + (-dy / len) * offset;
  const cy = midY + (dx / len) * offset;
  return `M${edge.x1},${edge.y1} Q${cx},${cy} ${edge.x2},${edge.y2}`;
}

export function ClusterLinkLayer() {
  const projects = useProjectStore((s) => s.projects);
  const viewport = useCanvasStore((s) => s.viewport);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<string | null>).detail;
      setHoveredId(id);
    };
    window.addEventListener("termcanvas:terminal-hover", handler);
    return () =>
      window.removeEventListener("termcanvas:terminal-hover", handler);
  }, []);

  const rects = useMemo(() => collectTerminals(projects), [projects]);
  const edges = useMemo(() => buildParentChildEdges(rects), [rects]);
  const family = useMemo(
    () => getFamilyIds(rects, hoveredId),
    [rects, hoveredId],
  );

  const baseOpacity =
    viewport.scale >= ZOOM_THRESHOLD
      ? 0
      : viewport.scale <= ZOOM_THRESHOLD - FADE_BAND
        ? 1
        : (ZOOM_THRESHOLD - viewport.scale) / FADE_BAND;

  if (baseOpacity === 0) return null;
  if (edges.length === 0 && family.size === 0) return null;

  const familyHasMembers = family.size > 1;

  return (
    <svg
      className="absolute inset-0"
      width="100%"
      height="100%"
      style={{
        pointerEvents: "none",
        opacity: baseOpacity,
      }}
      aria-hidden="true"
    >
      <g
        transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
      >
        {edges.map((edge) => {
          const isFamilyEdge =
            familyHasMembers &&
            family.has(edge.parentId) &&
            family.has(edge.childId);
          return (
            <path
              key={edge.id}
              d={curvedPath(edge)}
              fill="none"
              stroke={
                isFamilyEdge
                  ? "color-mix(in srgb, var(--accent) 70%, transparent)"
                  : "var(--text-faint)"
              }
              strokeWidth={1}
              strokeDasharray={isFamilyEdge ? undefined : "3 3"}
              vectorEffect="non-scaling-stroke"
              style={{
                opacity: isFamilyEdge ? 0.85 : 0.5,
                transition:
                  "stroke var(--duration-quick) var(--ease-out-soft), opacity var(--duration-quick) var(--ease-out-soft)",
              }}
            />
          );
        })}
        {rects.map((rect) => {
          const inFamily = familyHasMembers && family.has(rect.id);
          return (
            <rect
              key={`outline-${rect.id}`}
              x={rect.x - OUTLINE_PADDING}
              y={rect.y - OUTLINE_PADDING}
              width={rect.w + OUTLINE_PADDING * 2}
              height={rect.h + OUTLINE_PADDING * 2}
              rx={OUTLINE_RADIUS}
              ry={OUTLINE_RADIUS}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{
                opacity: inFamily ? 0.4 : 0,
                transition: inFamily
                  ? "opacity var(--duration-quick) var(--ease-out-soft)"
                  : "opacity var(--duration-instant) var(--ease-in-soft)",
              }}
            />
          );
        })}
      </g>
    </svg>
  );
}
