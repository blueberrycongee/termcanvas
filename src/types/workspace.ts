import type { SceneDocument } from "./scene";

export interface WorkspaceCanvas {
  id: string;
  name: string;
  createdAt: number;
  scene: SceneDocument;
}

export interface WorkspaceDocument {
  version: 3;
  activeCanvasId: string;
  canvases: WorkspaceCanvas[];
}

export const DEFAULT_CANVAS_NAME = "Default";
