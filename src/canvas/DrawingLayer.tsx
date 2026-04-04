import { useRef, useCallback } from "react";
import getStroke from "perfect-freehand";
import {
  useDrawingStore,
  drawingId,
  type DrawingElement,
  type StrokePoint,
} from "../stores/drawingStore";
import { useCanvasStore } from "../stores/canvasStore";

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

export function DrawingLayer() {
  const { tool, color, elements, activeElement, addElement, setActiveElement } =
    useDrawingStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const pointsRef = useRef<StrokePoint[]>([]);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const toCanvas = useCallback((e: React.MouseEvent) => {
    const { viewport } = useCanvasStore.getState();
    return {
      x: (e.clientX - viewport.x) / viewport.scale,
      y: (e.clientY - viewport.y) / viewport.scale,
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (tool === "select") return;
      e.stopPropagation();
      e.preventDefault();

      const pos = toCanvas(e);

      if (tool === "pen") {
        pointsRef.current = [{ x: pos.x, y: pos.y, pressure: 0.5 }];
        setActiveElement({
          id: drawingId(),
          type: "pen",
          points: pointsRef.current,
          color,
          size: 3,
        });
      } else if (tool === "text") {
        const content = window.prompt("Enter text:");
        if (content) {
          addElement({
            id: drawingId(),
            type: "text",
            x: pos.x,
            y: pos.y,
            content,
            color,
            fontSize: 16,
          });
        }
        useDrawingStore.getState().setTool("select");
      } else if (tool === "rect" || tool === "arrow") {
        startRef.current = pos;
        if (tool === "rect") {
          setActiveElement({
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
          setActiveElement({
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
    [tool, color, toCanvas, addElement, setActiveElement],
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
        setActiveElement({
          ...activeElement,
          points: pointsRef.current,
        });
      } else if (activeElement.type === "rect" && startRef.current) {
        setActiveElement({
          ...activeElement,
          x: Math.min(startRef.current.x, pos.x),
          y: Math.min(startRef.current.y, pos.y),
          w: Math.abs(pos.x - startRef.current.x),
          h: Math.abs(pos.y - startRef.current.y),
        });
      } else if (activeElement.type === "arrow") {
        setActiveElement({
          ...activeElement,
          x2: pos.x,
          y2: pos.y,
        });
      }
    },
    [activeElement, toCanvas, setActiveElement],
  );

  const handleMouseUp = useCallback(() => {
    if (!activeElement) return;
    addElement(activeElement);
    pointsRef.current = [];
    startRef.current = null;
  }, [activeElement, addElement]);

  const isDrawing = tool !== "select";
  const { viewport } = useCanvasStore();

  return (
    <svg
      ref={svgRef}
      className="fixed inset-0 w-screen h-screen"
      style={{
        pointerEvents: isDrawing ? "auto" : "none",
        cursor: isDrawing ? "crosshair" : "default",
        zIndex: isDrawing ? 30 : 0,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <g
        transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.scale})`}
      >
        {elements.map(renderElement)}
        {activeElement && renderElement(activeElement)}
      </g>
    </svg>
  );
}
