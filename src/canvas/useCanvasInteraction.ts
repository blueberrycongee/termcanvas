import { useCallback, useRef } from "react";
import { useCanvasStore } from "../stores/canvasStore";

const MIN_SCALE = 0.1;
const MAX_SCALE = 2.0;
const ZOOM_SENSITIVITY = 0.001;

export function useCanvasInteraction() {
  const { viewport, setViewport } = useCanvasStore();
  const isPanning = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        e.preventDefault();
        const delta = -e.deltaY * ZOOM_SENSITIVITY;
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, viewport.scale * (1 + delta)),
        );

        // Zoom toward cursor position
        const rect = e.currentTarget.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        const scaleRatio = newScale / viewport.scale;
        const newX = cursorX - (cursorX - viewport.x) * scaleRatio;
        const newY = cursorY - (cursorY - viewport.y) * scaleRatio;

        setViewport({ x: newX, y: newY, scale: newScale });
      } else {
        // Pan
        setViewport({
          x: viewport.x - e.deltaX,
          y: viewport.y - e.deltaY,
        });
      }
    },
    [viewport, setViewport],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Left or middle mouse button for panning
    if (e.button === 0 || e.button === 1) {
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
