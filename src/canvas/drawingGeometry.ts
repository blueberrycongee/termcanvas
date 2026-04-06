import type { DrawingElement } from "../stores/drawingStore";

export interface DrawingBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

function normalizeRect(
  x: number,
  y: number,
  w: number,
  h: number,
): DrawingBounds {
  const normalizedX = w < 0 ? x + w : x;
  const normalizedY = h < 0 ? y + h : y;
  return {
    x: normalizedX,
    y: normalizedY,
    w: Math.abs(w),
    h: Math.abs(h),
  };
}

function moveAnchor<T extends DrawingElement>(element: T, dx: number, dy: number): T {
  if (!element.anchor) {
    return element;
  }

  if (element.anchor.kind === "world") {
    return {
      ...element,
      anchor: {
        ...element.anchor,
        position: {
          x: element.anchor.position.x + dx,
          y: element.anchor.position.y + dy,
        },
      },
    };
  }

  return {
    ...element,
    anchor: {
      ...element.anchor,
      offset: {
        x: element.anchor.offset.x + dx,
        y: element.anchor.offset.y + dy,
      },
    },
  };
}

export function getDrawingElementBounds(element: DrawingElement): DrawingBounds {
  switch (element.type) {
    case "pen": {
      if (element.points.length === 0) {
        return { x: 0, y: 0, w: 0, h: 0 };
      }

      const xs = element.points.map((point) => point.x);
      const ys = element.points.map((point) => point.y);
      const inset = Math.max(2, element.size / 2);
      const minX = Math.min(...xs) - inset;
      const maxX = Math.max(...xs) + inset;
      const minY = Math.min(...ys) - inset;
      const maxY = Math.max(...ys) + inset;
      return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
      };
    }
    case "text": {
      const width = Math.max(element.content.length, 1) * element.fontSize * 0.62;
      const height = element.fontSize * 1.35;
      return {
        x: element.x,
        y: element.y,
        w: width,
        h: height,
      };
    }
    case "rect":
      return normalizeRect(element.x, element.y, element.w, element.h);
    case "arrow": {
      const minX = Math.min(element.x1, element.x2);
      const minY = Math.min(element.y1, element.y2);
      const maxX = Math.max(element.x1, element.x2);
      const maxY = Math.max(element.y1, element.y2);
      const inset = Math.max(10, element.strokeWidth * 2);
      return {
        x: minX - inset,
        y: minY - inset,
        w: maxX - minX + inset * 2,
        h: maxY - minY + inset * 2,
      };
    }
  }
}

export function translateDrawingElement(
  element: DrawingElement,
  dx: number,
  dy: number,
): DrawingElement {
  switch (element.type) {
    case "pen":
      return moveAnchor(
        {
          ...element,
          points: element.points.map((point) => ({
            ...point,
            x: point.x + dx,
            y: point.y + dy,
          })),
        },
        dx,
        dy,
      );
    case "text":
      return moveAnchor(
        {
          ...element,
          x: element.x + dx,
          y: element.y + dy,
        },
        dx,
        dy,
      );
    case "rect":
      return moveAnchor(
        {
          ...element,
          x: element.x + dx,
          y: element.y + dy,
        },
        dx,
        dy,
      );
    case "arrow":
      return moveAnchor(
        {
          ...element,
          x1: element.x1 + dx,
          y1: element.y1 + dy,
          x2: element.x2 + dx,
          y2: element.y2 + dy,
        },
        dx,
        dy,
      );
  }
}
