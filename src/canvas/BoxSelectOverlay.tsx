import { useSelectionStore } from "../stores/selectionStore";
import { useCanvasStore } from "../stores/canvasStore";

export function BoxSelectOverlay() {
  const rect = useSelectionStore((s) => s.selectionRect);
  const viewport = useCanvasStore((s) => s.viewport);

  if (!rect) return null;

  const x = rect.w < 0 ? rect.x + rect.w : rect.x;
  const y = rect.h < 0 ? rect.y + rect.h : rect.y;
  const w = Math.abs(rect.w);
  const h = Math.abs(rect.h);

  const screenX = x * viewport.scale + viewport.x;
  const screenY = y * viewport.scale + viewport.y;
  const screenW = w * viewport.scale;
  const screenH = h * viewport.scale;

  return (
    <svg
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      <rect
        x={screenX}
        y={screenY}
        width={screenW}
        height={screenH}
        fill="rgba(59,130,246,0.08)"
        stroke="#3b82f6"
        strokeDasharray="4 2"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
