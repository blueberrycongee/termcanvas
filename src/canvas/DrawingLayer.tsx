import { useRef, useCallback } from "react";
import getStroke from "perfect-freehand";
import {
  addAnnotationToScene,
  setAnnotationToolInScene,
  setDraftAnnotationInScene,
  updateAnnotationInScene,
} from "../actions/annotationSceneActions";
import { activateAnnotationInScene } from "../actions/sceneSelectionActions";
import {
  getDrawingElementBounds,
  resolveDrawingElementForRender,
  translateDrawingElement,
} from "./annotationGeometry";
import {
  useDrawingStore,
  drawingId,
  type DrawingElement,
  type StrokePoint,
} from "../stores/drawingStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useSelectionStore } from "../stores/selectionStore";
import {
  getCanvasLeftInset,
  screenPointToCanvasPoint,
} from "./viewportBounds";

function getSvgPathFromStroke(stroke: number[][]) {
  if (stroke.length === 0) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"],
  );
  d.push("Z");
  return d.join(" ");
}

function renderElement(el: DrawingElement) {
  switch (el.type) {
    case "pen": {
      const outlinePoints = getStroke(el.points, {
        size: el.size,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      });
      const pathData = getSvgPathFromStroke(outlinePoints);
      return <path key={el.id} d={pathData} fill={el.color} stroke="none" />;
    }
    case "text":
      return (
        <text
          key={el.id}
          x={el.x}
          y={el.y}
          fill={el.color}
          fontSize={el.fontSize}
          fontFamily='"Geist Sans", sans-serif'
          dominantBaseline="hanging"
          style={{ userSelect: "none" }}
        >
          {el.content}
        </text>
      );
    case "rect":
      return (
        <rect
          key={el.id}
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          fill="none"
          stroke={el.color}
          strokeWidth={el.strokeWidth}
          rx={4}
        />
      );
    case "arrow": {
      const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
      const headLen = 12;
      return (
        <g key={el.id}>
          <line
            x1={el.x1}
            y1={el.y1}
            x2={el.x2}
            y2={el.y2}
            stroke={el.color}
            strokeWidth={el.strokeWidth}
            strokeLinecap="round"
          />
          <polyline
            points={`
              ${el.x2 - headLen * Math.cos(angle - Math.PI / 6)},${el.y2 - headLen * Math.sin(angle - Math.PI / 6)}
              ${el.x2},${el.y2}
              ${el.x2 - headLen * Math.cos(angle + Math.PI / 6)},${el.y2 - headLen * Math.sin(angle + Math.PI / 6)}
            `}
            fill="none"
            stroke={el.color}
            strokeWidth={el.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    }
  }
}

function renderSelectionOutline(el: DrawingElement) {
  const bounds = getDrawingElementBounds(el);
  return (
    <rect
      x={bounds.x - 6}
      y={bounds.y - 6}
      width={bounds.w + 12}
      height={bounds.h + 12}
      rx={8}
      fill="none"
      stroke="var(--accent)"
      strokeWidth={1.5}
      strokeDasharray="6 4"
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

function renderHitArea(el: DrawingElement) {
  const bounds = getDrawingElementBounds(el);
  return (
    <rect
      x={bounds.x}
      y={bounds.y}
      width={Math.max(bounds.w, 12)}
      height={Math.max(bounds.h, 12)}
      fill="rgba(0,0,0,0.001)"
      stroke="none"
    />
  );
}

export function DrawingLayer() {
  const { tool, color, elements, activeElement } = useDrawingStore();
  const projects = useProjectStore((state) => state.projects);
  const selectedAnnotationIds = useSelectionStore((state) =>
    state.selectedItems.flatMap((item) =>
      item.type === "annotation" ? [item.annotationId] : [],
    ),
  );
  const pointsRef = useRef<StrokePoint[]>([]);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    element: DrawingElement;
    startX: number;
    startY: number;
  } | null>(null);
  const leftPanelCollapsed = useCanvasStore((state) => state.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((state) => state.leftPanelWidth);
  const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);

  const toCanvas = useCallback((e: React.MouseEvent) => {
    const { viewport, leftPanelCollapsed, leftPanelWidth } =
      useCanvasStore.getState();
    return screenPointToCanvasPoint(
      e.clientX,
      e.clientY,
      viewport,
      leftPanelCollapsed,
      leftPanelWidth,
    );
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (tool === "select") return;
      e.stopPropagation();
      e.preventDefault();

      const pos = toCanvas(e);

      if (tool === "pen") {
        pointsRef.current = [{ x: pos.x, y: pos.y, pressure: 0.5 }];
        setDraftAnnotationInScene({
          id: drawingId(),
          type: "pen",
          points: pointsRef.current,
          color,
          size: 3,
        });
      } else if (tool === "text") {
        const content = window.prompt("Enter text:");
        if (content) {
          addAnnotationToScene({
            id: drawingId(),
            type: "text",
            x: pos.x,
            y: pos.y,
            content,
            color,
            fontSize: 16,
          });
        }
        setAnnotationToolInScene("select");
      } else if (tool === "rect" || tool === "arrow") {
        startRef.current = pos;
        if (tool === "rect") {
          setDraftAnnotationInScene({
            id: drawingId(),
            type: "rect",
            x: pos.x,
            y: pos.y,
            w: 0,
            h: 0,
            color,
            strokeWidth: 2,
          });
        } else {
          setDraftAnnotationInScene({
            id: drawingId(),
            type: "arrow",
            x1: pos.x,
            y1: pos.y,
            x2: pos.x,
            y2: pos.y,
            color,
            strokeWidth: 2,
          });
        }
      }
    },
    [color, toCanvas, tool],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!activeElement) return;

      const pos = toCanvas(e);

      if (activeElement.type === "pen") {
        pointsRef.current = [
          ...pointsRef.current,
          { x: pos.x, y: pos.y, pressure: 0.5 },
        ];
        setDraftAnnotationInScene({
          ...activeElement,
          points: pointsRef.current,
        });
      } else if (activeElement.type === "rect" && startRef.current) {
        setDraftAnnotationInScene({
          ...activeElement,
          x: Math.min(startRef.current.x, pos.x),
          y: Math.min(startRef.current.y, pos.y),
          w: Math.abs(pos.x - startRef.current.x),
          h: Math.abs(pos.y - startRef.current.y),
        });
      } else if (activeElement.type === "arrow") {
        setDraftAnnotationInScene({
          ...activeElement,
          x2: pos.x,
          y2: pos.y,
        });
      }
    },
    [activeElement, toCanvas],
  );

  const handleMouseUp = useCallback(() => {
    if (!activeElement) return;
    addAnnotationToScene(activeElement);
    pointsRef.current = [];
    startRef.current = null;
  }, [activeElement]);

  const handleElementMouseDown = useCallback(
    (element: DrawingElement, e: React.MouseEvent) => {
      if (tool !== "select") {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      activateAnnotationInScene(element.id);
      const start = toCanvas(e);
      dragRef.current = {
        element,
        startX: start.x,
        startY: start.y,
      };

      const handleMove = (event: MouseEvent) => {
        if (!dragRef.current) {
          return;
        }
        const point = screenPointToCanvasPoint(
          event.clientX,
          event.clientY,
          useCanvasStore.getState().viewport,
          useCanvasStore.getState().leftPanelCollapsed,
          useCanvasStore.getState().leftPanelWidth,
        );
        const dx = point.x - dragRef.current.startX;
        const dy = point.y - dragRef.current.startY;
        const translated = translateDrawingElement(
          dragRef.current.element,
          dx,
          dy,
        );
        updateAnnotationInScene(element.id, translated);
      };

      const handleUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [toCanvas, tool],
  );

  const isDrawing = tool !== "select";
  const { viewport } = useCanvasStore();

  return (
    <svg
      className="fixed top-0 right-0 bottom-0"
      style={{
        left: leftOffset,
        pointerEvents: isDrawing ? "auto" : "none",
        cursor: isDrawing ? "crosshair" : "default",
        zIndex: isDrawing ? 30 : 20,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <g
        transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.scale})`}
      >
        {elements.map((element) => {
          const renderedElement = resolveDrawingElementForRender(element, projects);
          const isSelected = selectedAnnotationIds.includes(element.id);
          return (
            <g
              key={element.id}
              style={{ pointerEvents: tool === "select" ? "auto" : "none" }}
              onMouseDown={(event) => handleElementMouseDown(element, event)}
            >
              {renderHitArea(renderedElement)}
              {renderElement(renderedElement)}
              {isSelected && renderSelectionOutline(renderedElement)}
            </g>
          );
        })}
        {activeElement && renderElement(activeElement)}
      </g>
    </svg>
  );
}
