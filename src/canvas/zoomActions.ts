import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { TOOLBAR_HEIGHT } from "../toolbar/toolbarHeight";
import {
  getCanvasLeftInset,
  getCanvasRightInset,
} from "./viewportBounds";
import {
  clampScale,
  getNextZoomStep,
  getViewportCenterClientPoint,
  zoomAtClientPoint,
} from "./viewportZoom";

const FIT_PADDING = 80;

function getCanvasInsets() {
  const {
    leftPanelCollapsed,
    leftPanelWidth,
    rightPanelCollapsed,
    rightPanelWidth,
  } = useCanvasStore.getState();
  return {
    leftPanelCollapsed,
    leftPanelWidth,
    rightPanelCollapsed,
    rightPanelWidth,
  };
}

export function fitAllProjects(): void {
  const { projects } = useProjectStore.getState();
  if (projects.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const project of projects) {
    for (const wt of project.worktrees) {
      for (const term of wt.terminals) {
        if (term.stashed) continue;
        minX = Math.min(minX, term.x);
        minY = Math.min(minY, term.y);
        maxX = Math.max(maxX, term.x + term.width);
        maxY = Math.max(maxY, term.y + term.height);
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;

  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const insets = getCanvasInsets();
  const leftOffset = getCanvasLeftInset(
    insets.leftPanelCollapsed,
    insets.leftPanelWidth,
  );
  const rightOffset = getCanvasRightInset(
    insets.rightPanelCollapsed,
    insets.rightPanelWidth,
  );
  const viewW = window.innerWidth - leftOffset - rightOffset - FIT_PADDING * 2;
  const viewH = window.innerHeight - TOOLBAR_HEIGHT - FIT_PADDING * 2;
  const scale = clampScale(Math.min(1, viewW / contentW, viewH / contentH));
  const x = -minX * scale + FIT_PADDING;
  const y = -minY * scale + FIT_PADDING + TOOLBAR_HEIGHT;
  useCanvasStore.getState().setViewport({ x, y, scale });
}

export function setZoomToHundred(): void {
  zoomAroundCenter(1);
}

export function stepZoomAtCenter(direction: "in" | "out"): void {
  const viewport = useCanvasStore.getState().viewport;
  const nextScale = getNextZoomStep(viewport.scale, direction);
  zoomAroundCenter(nextScale);
}

function zoomAroundCenter(nextScale: number): void {
  const insets = getCanvasInsets();
  const center = getViewportCenterClientPoint({
    leftPanelCollapsed: insets.leftPanelCollapsed,
    leftPanelWidth: insets.leftPanelWidth,
    rightPanelCollapsed: insets.rightPanelCollapsed,
    rightPanelWidth: insets.rightPanelWidth,
    topInset: TOOLBAR_HEIGHT,
  });
  const viewport = useCanvasStore.getState().viewport;
  useCanvasStore.getState().setViewport(
    zoomAtClientPoint({
      clientX: center.x,
      clientY: center.y,
      leftPanelCollapsed: insets.leftPanelCollapsed,
      leftPanelWidth: insets.leftPanelWidth,
      nextScale: clampScale(nextScale),
      viewport,
    }),
  );
}
