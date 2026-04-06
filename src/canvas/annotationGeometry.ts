import type { DrawingElement } from "../stores/drawingStore";
import type { ProjectData } from "../types";
import type { AnnotationAnchor } from "../types/scene";
import { getTerminalGeometry } from "../terminal/terminalGeometryRegistry";
import {
  packTerminals,
  PROJ_PAD,
  PROJ_TITLE_H,
  WT_PAD,
  WT_TITLE_H,
} from "../layout";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function translateAnchor(
  anchor: AnnotationAnchor | undefined,
  dx: number,
  dy: number,
): AnnotationAnchor | undefined {
  if (!anchor) {
    return undefined;
  }

  if (anchor.kind === "world") {
    return {
      ...anchor,
      position: {
        x: anchor.position.x + dx,
        y: anchor.position.y + dy,
      },
    };
  }

  return {
    ...anchor,
    offset: {
      x: anchor.offset.x + dx,
      y: anchor.offset.y + dy,
    },
  };
}

function shiftDrawingElement(
  element: DrawingElement,
  dx: number,
  dy: number,
): DrawingElement {
  switch (element.type) {
    case "pen":
      return {
        ...element,
        points: element.points.map((point) => ({
          ...point,
          x: point.x + dx,
          y: point.y + dy,
        })),
      };
    case "text":
      return {
        ...element,
        x: element.x + dx,
        y: element.y + dy,
      };
    case "rect":
      return {
        ...element,
        x: element.x + dx,
        y: element.y + dy,
      };
    case "arrow":
      return {
        ...element,
        x1: element.x1 + dx,
        y1: element.y1 + dy,
        x2: element.x2 + dx,
        y2: element.y2 + dy,
      };
  }
}

function getDrawingElementOrigin(element: DrawingElement): { x: number; y: number } | null {
  switch (element.type) {
    case "pen":
      return element.points[0]
        ? { x: element.points[0].x, y: element.points[0].y }
        : null;
    case "text":
      return { x: element.x, y: element.y };
    case "rect":
      return { x: element.x, y: element.y };
    case "arrow":
      return { x: element.x1, y: element.y1 };
  }
}

function resolveEntityAnchorWorldPoint(
  entityId: string,
  offset: { x: number; y: number },
  projects: ProjectData[],
): { x: number; y: number } | null {
  const terminalGeometry = getTerminalGeometry(entityId);
  if (terminalGeometry) {
    return {
      x: terminalGeometry.x + offset.x,
      y: terminalGeometry.y + offset.y,
    };
  }

  for (const project of projects) {
    if (project.id === entityId) {
      return {
        x: project.position.x + offset.x,
        y: project.position.y + offset.y,
      };
    }

    for (const worktree of project.worktrees) {
      if (worktree.id === entityId) {
        return {
          x: project.position.x + PROJ_PAD + worktree.position.x + offset.x,
          y:
            project.position.y +
            PROJ_TITLE_H +
            PROJ_PAD +
            worktree.position.y +
            offset.y,
        };
      }

      const visibleTerminals = worktree.terminals.filter(
        (terminal) => !terminal.stashed,
      );
      const packed = packTerminals(visibleTerminals.map((terminal) => terminal.span));
      const terminalIndex = visibleTerminals.findIndex(
        (terminal) => terminal.id === entityId,
      );
      const item = terminalIndex >= 0 ? packed[terminalIndex] : null;
      if (item) {
        return {
          x:
            project.position.x +
            PROJ_PAD +
            worktree.position.x +
            WT_PAD +
            item.x +
            offset.x,
          y:
            project.position.y +
            PROJ_TITLE_H +
            PROJ_PAD +
            worktree.position.y +
            WT_TITLE_H +
            WT_PAD +
            item.y +
            offset.y,
        };
      }
    }
  }

  return null;
}

export function resolveSceneAnchorWorldPoint(
  anchor: AnnotationAnchor | undefined,
  projects: ProjectData[],
): { x: number; y: number } | null {
  if (!anchor) {
    return null;
  }

  if (anchor.kind === "world") {
    return anchor.position;
  }

  return resolveEntityAnchorWorldPoint(
    anchor.entityId,
    anchor.offset,
    projects,
  );
}

export function getDrawingElementBounds(element: DrawingElement): Rect {
  switch (element.type) {
    case "pen": {
      if (element.points.length === 0) {
        return { x: 0, y: 0, w: 0, h: 0 };
      }

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of element.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      const padding = Math.max(6, element.size);
      return {
        x: minX - padding,
        y: minY - padding,
        w: maxX - minX + padding * 2,
        h: maxY - minY + padding * 2,
      };
    }
    case "text": {
      const lines = element.content.split(/\r?\n/);
      const maxLineLength = lines.reduce(
        (max, line) => Math.max(max, line.length),
        0,
      );
      const width = Math.max(element.fontSize, maxLineLength * element.fontSize * 0.62);
      const height = Math.max(
        element.fontSize * 1.4,
        lines.length * element.fontSize * 1.4,
      );
      return {
        x: element.x,
        y: element.y,
        w: width,
        h: height,
      };
    }
    case "rect":
      return {
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
      };
    case "arrow": {
      const padding = Math.max(12, element.strokeWidth * 2);
      const minX = Math.min(element.x1, element.x2) - padding;
      const minY = Math.min(element.y1, element.y2) - padding;
      const maxX = Math.max(element.x1, element.x2) + padding;
      const maxY = Math.max(element.y1, element.y2) + padding;
      return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
      };
    }
  }
}

export function translateDrawingElement(
  element: DrawingElement,
  dx: number,
  dy: number,
): DrawingElement {
  return {
    ...shiftDrawingElement(element, dx, dy),
    anchor: translateAnchor(element.anchor, dx, dy),
  };
}

export function resolveDrawingElementForRender(
  element: DrawingElement,
  projects: ProjectData[],
): DrawingElement {
  if (!element.anchor || element.anchor.kind !== "entity") {
    return element;
  }

  const origin = getDrawingElementOrigin(element);
  if (!origin) {
    return element;
  }

  const anchorPoint = resolveSceneAnchorWorldPoint(element.anchor, projects);
  if (!anchorPoint) {
    return element;
  }

  return shiftDrawingElement(
    element,
    anchorPoint.x - origin.x,
    anchorPoint.y - origin.y,
  );
}
