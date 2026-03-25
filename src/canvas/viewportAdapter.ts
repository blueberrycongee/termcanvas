import type { Viewport as FlowViewport } from "@xyflow/react";
import type { Viewport } from "../types";
import type { SceneCamera } from "../types/scene";

export function toFlowViewport(viewport: Viewport): FlowViewport {
  return {
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.scale,
  };
}

export function fromFlowViewport(viewport: FlowViewport): Viewport {
  return {
    x: viewport.x,
    y: viewport.y,
    scale: viewport.zoom,
  };
}

export function sceneCameraToFlowViewport(camera: SceneCamera): FlowViewport {
  return {
    x: camera.x,
    y: camera.y,
    zoom: camera.zoom,
  };
}
