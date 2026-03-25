import { Canvas } from "./Canvas";
import { XyFlowCanvas } from "./XyFlowCanvas";
import { isXyflowRendererEnabled } from "./rendererMode";

export function CanvasRoot() {
  if (isXyflowRendererEnabled()) {
    return <XyFlowCanvas />;
  }

  return <Canvas />;
}
