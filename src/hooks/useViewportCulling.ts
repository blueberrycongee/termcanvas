import { useMemo } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { getProjectBounds } from "../stores/projectStore";
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
      const bounds = getProjectBounds(project);
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
