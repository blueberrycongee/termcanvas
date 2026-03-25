import type { ProjectData } from "./index";
import type { BrowserCardData } from "../stores/browserCardStore";

export interface ScenePoint {
  x: number;
  y: number;
}

export interface SceneSize {
  width: number;
  height: number;
}

export interface SceneCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface SceneSelection {
  projectIds: string[];
  worktreeIds: string[];
  terminalIds: string[];
  cardIds: string[];
  annotationIds: string[];
}

export type SceneNodeKind = "project" | "worktree";

export interface SceneNodeRecord {
  id: string;
  entityId: string;
  entityKind: SceneNodeKind;
  parentId?: string;
  position: ScenePoint;
  size: SceneSize;
  collapsed: boolean;
}

export type AnnotationTool = "pen" | "text" | "rect" | "arrow";

export type AnnotationAnchor =
  | {
      kind: "world";
      position: ScenePoint;
    }
  | {
      kind: "entity";
      entityId: string;
      offset: ScenePoint;
    };

export interface AnnotationStrokePoint extends ScenePoint {
  pressure?: number;
}

export interface AnnotationPenElement {
  id: string;
  type: "pen";
  anchor: AnnotationAnchor;
  color: string;
  size: number;
  points: AnnotationStrokePoint[];
}

export interface AnnotationTextElement {
  id: string;
  type: "text";
  anchor: AnnotationAnchor;
  color: string;
  fontSize: number;
  content: string;
}

export interface AnnotationRectElement {
  id: string;
  type: "rect";
  anchor: AnnotationAnchor;
  color: string;
  strokeWidth: number;
  width: number;
  height: number;
}

export interface AnnotationArrowElement {
  id: string;
  type: "arrow";
  anchor: AnnotationAnchor;
  color: string;
  strokeWidth: number;
  end: ScenePoint;
}

export type AnnotationElement =
  | AnnotationPenElement
  | AnnotationTextElement
  | AnnotationRectElement
  | AnnotationArrowElement;

export interface SceneDocument {
  version: 2;
  camera: SceneCamera;
  projects: ProjectData[];
  browserCards: Record<string, BrowserCardData>;
  annotations: AnnotationElement[];
}

export interface SceneRuntime {
  renderer: "legacy" | "xyflow";
  selection: SceneSelection;
}
