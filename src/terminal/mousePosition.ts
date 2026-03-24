interface MouseRect {
  left: number;
  top: number;
}

interface MousePoint {
  clientX: number;
  clientY: number;
}

export interface CorrectedTerminalMousePosition {
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
}

export function getCorrectedTerminalMousePosition(
  point: MousePoint,
  rect: MouseRect,
  scale: number,
): CorrectedTerminalMousePosition {
  const offsetX = (point.clientX - rect.left) / scale;
  const offsetY = (point.clientY - rect.top) / scale;

  return {
    clientX: rect.left + offsetX,
    clientY: rect.top + offsetY,
    offsetX,
    offsetY,
  };
}

export function shouldDebugTerminalMouseCorrection() {
  return (
    typeof localStorage !== "undefined" &&
    localStorage.getItem("termcanvas-debug-terminal-mouse") === "1"
  );
}
