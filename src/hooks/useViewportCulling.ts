import { useMemo } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { computeWorktreeSize } from "../layout";
import type { ProjectData } from "../types";

const MARGIN = 200; // extra pixels in canvas space to avoid pop-in

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
      if (project.collapsed) {
        // Collapsed projects are small, use fixed size
        const pRight = project.position.x + 340;
        const pBottom = project.position.y + 80;
        if (
          project.position.x < vRight &&
          pRight > vLeft &&
          project.position.y < vBottom &&
          pBottom > vTop
        ) {
          visible.add(project.id);
        }
      } else {
        // Compute full size from worktrees
        let maxW = 340;
        let maxH = 100;
        for (const wt of project.worktrees) {
          const wtSize = computeWorktreeSize(wt.terminals.map((t) => t.span));
          maxW = Math.max(maxW, wt.position.x + wtSize.w);
          maxH = Math.max(maxH, wt.position.y + wtSize.h);
        }
        const pRight = project.position.x + maxW;
        const pBottom = project.position.y + maxH;
        if (
          project.position.x < vRight &&
          pRight > vLeft &&
          project.position.y < vBottom &&
          pBottom > vTop
        ) {
          visible.add(project.id);
        }
      }
    }
    return visible;
  }, [projects, viewport]);
}
