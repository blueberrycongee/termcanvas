import { Canvas } from "./Canvas";
import { XyFlowCanvas } from "./XyFlowCanvas";
import { getCanvasRendererMode } from "./rendererMode";

export function CanvasRoot() {
  const mode = getCanvasRendererMode();

  if (mode === "xyflow") {
    return <XyFlowCanvas />;
  }

  return <Canvas />;
}
