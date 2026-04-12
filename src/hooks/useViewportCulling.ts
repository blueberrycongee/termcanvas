import { useMemo } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import type { ProjectData } from "../types";

const MARGIN = 200; // extra pixels in canvas space to avoid pop-in

/**
 * Compute the bounding box of a project from its terminals' positions.
 */
function getProjectBoundsFromTerminals(project: ProjectData): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wt of project.worktrees) {
    for (const t of wt.terminals) {
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + t.width);
      maxY = Math.max(maxY, t.y + t.height);
    }
  }
  if (!isFinite(minX)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function useViewportCulling(projects: ProjectData[]): Set<string> {
  const viewport = useCanvasStore((s) => s.viewport);

  return useMemo(() => {
    const vw = window.innerWidth / viewport.scale;
    const vh = window.innerHeight / viewport.scale;
    const vLeft = -viewport.x / viewport.scale - MARGIN;
    const vTop = -viewport.y / viewport.scale - MARGIN;
    const vRight = vLeft + vw + MARGIN * 2;
    const vBottom = vTop + vh + MARGIN * 2;

    const visible = new Set<string>();
    for (const project of projects) {
      const bounds = getProjectBoundsFromTerminals(project);
      const pRight = bounds.x + bounds.w;
      const pBottom = bounds.y + bounds.h;
      if (
        bounds.x < vRight &&
        pRight > vLeft &&
        bounds.y < vBottom &&
        pBottom > vTop
      ) {
        visible.add(project.id);
      }
    }
    return visible;
  }, [projects, viewport]);
}
