import { useCallback, useRef } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { useDrawingStore } from "../stores/drawingStore";

const MIN_SCALE = 0.1;
const MAX_SCALE = 2.0;
const ZOOM_SPEED = 0.005;
const LERP_SPEED = 0.18;
const LERP_EPSILON = 0.0005;

export function useCanvasInteraction() {
  const isPanning = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const zoomTarget = useRef({ x: 0, y: 0, scale: 1 });
  const zoomCursor = useRef({ x: 0, y: 0 });
  const zoomAnimating = useRef(false);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      const rect = e.currentTarget.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      zoomCursor.current = { x: cursorX, y: cursorY };

      const prev = zoomAnimating.current
        ? zoomTarget.current
        : useCanvasStore.getState().viewport;

      const factor = Math.pow(2, -e.deltaY * ZOOM_SPEED);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));

      const scaleRatio = newScale / prev.scale;
      zoomTarget.current = {
        x: cursorX - (cursorX - prev.x) * scaleRatio,
        y: cursorY - (cursorY - prev.y) * scaleRatio,
        scale: newScale,
      };

      if (!zoomAnimating.current) {
        zoomAnimating.current = true;
        requestAnimationFrame(zoomTick);
      }
    } else {
      const v = useCanvasStore.getState().viewport;
      useCanvasStore.getState().setViewport({
        x: v.x - e.deltaX,
        y: v.y - e.deltaY,
      });
    }
  }, []);

  const zoomTick = useCallback(() => {
    const { viewport, setViewport } = useCanvasStore.getState();
    const target = zoomTarget.current;

    const nextX = viewport.x + (target.x - viewport.x) * LERP_SPEED;
    const nextY = viewport.y + (target.y - viewport.y) * LERP_SPEED;
    const nextScale = viewport.scale + (target.scale - viewport.scale) * LERP_SPEED;

    setViewport({ x: nextX, y: nextY, scale: nextScale });

    const done =
      Math.abs(nextScale - target.scale) < LERP_EPSILON &&
      Math.abs(nextX - target.x) < 0.5 &&
      Math.abs(nextY - target.y) < 0.5;

    if (done) {
      setViewport(target);
      zoomAnimating.current = false;
    } else {
      requestAnimationFrame(zoomTick);
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const isDrawing = useDrawingStore.getState().tool !== "select";
    // Shift+left-click reserved for box select
    if (e.button === 0 && e.shiftKey) return;
    // Left-click pan disabled in drawing mode; middle-click always works
    if (e.button === 1 || (e.button === 0 && !isDrawing)) {
      e.preventDefault();
      isPanning.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };

      const handleMove = (ev: MouseEvent) => {
        if (!isPanning.current) return;
        const dx = ev.clientX - lastPos.current.x;
        const dy = ev.clientY - lastPos.current.y;
        lastPos.current = { x: ev.clientX, y: ev.clientY };
        const v = useCanvasStore.getState().viewport;
        useCanvasStore.getState().setViewport({ x: v.x + dx, y: v.y + dy });
      };

      const handleUp = () => {
        isPanning.current = false;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    }
  }, []);

  return {
    handleWheel,
    handleMouseDown,
  };
}
