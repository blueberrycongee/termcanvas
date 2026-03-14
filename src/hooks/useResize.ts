import { useRef, useCallback, type RefObject } from "react";
import { useCanvasStore } from "../stores/canvasStore";

interface ResizeState {
  startX: number;
  startY: number;
  origW: number;
  origH: number;
}

const MIN_W = 200;
const MIN_H = 100;

export function useResize(
  w: number,
  h: number,
  onResize: (w: number, h: number) => void,
  minW: number = MIN_W,
  minH: number = MIN_H,
  containerRef?: RefObject<HTMLElement | null>,
) {
  const resizeRef = useRef<ResizeState | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (resizeRef.current) return;
      e.stopPropagation();
      e.preventDefault();

      const scale = useCanvasStore.getState().viewport.scale;

      // When w or h is 0 (auto-sized), read actual rendered size from DOM
      let actualW = w;
      let actualH = h;
      if (containerRef?.current) {
        if (actualW <= 0) actualW = containerRef.current.offsetWidth;
        if (actualH <= 0) actualH = containerRef.current.offsetHeight;
      }

      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: actualW,
        origH: actualH,
      };

      const handleMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const deltaX = (ev.clientX - resizeRef.current.startX) / scale;
        const deltaY = (ev.clientY - resizeRef.current.startY) / scale;
        const newW = Math.max(minW, resizeRef.current.origW + deltaX);
        const newH = Math.max(minH, resizeRef.current.origH + deltaY);
        onResize(newW, newH);
      };

      const handleUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [w, h, onResize, minW, minH, containerRef],
  );

  return handleMouseDown;
}
