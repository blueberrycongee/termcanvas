import type { ProjectData, StashedTerminal, Viewport } from "../types";
import type { BrowserCardData } from "../stores/browserCardStore";
import type {
  AnnotationElement,
  AnnotationAnchor,
  SceneCamera,
  SceneDocument,
  SceneRuntime,
  SceneSelection,
} from "../types/scene";
import type { DrawingElement } from "../stores/drawingStore";
import type { SelectedItem } from "../stores/selectionStore";

interface LegacySceneState {
  viewport?: Viewport | null;
  projects?: ProjectData[] | null;
  drawings?: DrawingElement[] | null;
  browserCards?: Record<string, BrowserCardData> | null;
  stashedTerminals?: StashedTerminal[] | null;
}

function worldAnchor(position: { x: number; y: number }): AnnotationAnchor {
  return {
    kind: "world",
    position: {
      x: position.x,
      y: position.y,
    },
  };
}

function resolveDrawingAnchor(
  anchor: AnnotationAnchor | undefined,
  fallbackPosition: { x: number; y: number },
): AnnotationAnchor {
  return anchor ?? worldAnchor(fallbackPosition);
}

export function viewportToSceneCamera(viewport?: Viewport | null): SceneCamera {
  return {
    x: viewport?.x ?? 0,
    y: viewport?.y ?? 0,
    zoom: viewport?.scale ?? 1,
  };
}

export function sceneCameraToViewport(camera: SceneCamera): Viewport {
  return {
    x: camera.x,
    y: camera.y,
    scale: camera.zoom,
  };
}

export function drawingToAnnotation(element: DrawingElement): AnnotationElement {
  switch (element.type) {
    case "pen":
      return {
        id: element.id,
        type: "pen",
        anchor: resolveDrawingAnchor(
          element.anchor,
          element.points[0] ?? { x: 0, y: 0 },
        ),
        color: element.color,
        size: element.size,
        points: element.points.map((point) => ({
          x: point.x,
          y: point.y,
          pressure: point.pressure,
        })),
      };
    case "text":
      return {
        id: element.id,
        type: "text",
        anchor: resolveDrawingAnchor(element.anchor, {
          x: element.x,
          y: element.y,
        }),
        color: element.color,
        fontSize: element.fontSize,
        content: element.content,
      };
    case "rect":
      return {
        id: element.id,
        type: "rect",
        anchor: resolveDrawingAnchor(element.anchor, {
          x: element.x,
          y: element.y,
        }),
        color: element.color,
        strokeWidth: element.strokeWidth,
        width: element.w,
        height: element.h,
      };
    case "arrow":
      return {
        id: element.id,
        type: "arrow",
        anchor: resolveDrawingAnchor(element.anchor, {
          x: element.x1,
          y: element.y1,
        }),
        color: element.color,
        strokeWidth: element.strokeWidth,
        end: { x: element.x2, y: element.y2 },
      };
  }
}

function anchorToWorldPoint(anchor: AnnotationAnchor): { x: number; y: number } {
  if (anchor.kind === "world") {
    return anchor.position;
  }

  // Fall back to the stored local offset so persisted annotations still round-trip.
  return anchor.offset;
}

export function annotationToDrawing(
  element: AnnotationElement,
): DrawingElement {
  switch (element.type) {
    case "pen":
      return {
        id: element.id,
        type: "pen",
        anchor: element.anchor,
        color: element.color,
        size: element.size,
        points: element.points.map((point) => ({
          x: point.x,
          y: point.y,
          pressure: point.pressure,
        })),
      };
    case "text": {
      const point = anchorToWorldPoint(element.anchor);
      return {
        id: element.id,
        type: "text",
        anchor: element.anchor,
        color: element.color,
        fontSize: element.fontSize,
        content: element.content,
        x: point.x,
        y: point.y,
      };
    }
    case "rect": {
      const point = anchorToWorldPoint(element.anchor);
      return {
        id: element.id,
        type: "rect",
        anchor: element.anchor,
        color: element.color,
        strokeWidth: element.strokeWidth,
        w: element.width,
        h: element.height,
        x: point.x,
        y: point.y,
      };
    }
    case "arrow": {
      const point = anchorToWorldPoint(element.anchor);
      return {
        id: element.id,
        type: "arrow",
        anchor: element.anchor,
        color: element.color,
        strokeWidth: element.strokeWidth,
        x1: point.x,
        y1: point.y,
        x2: element.end.x,
        y2: element.end.y,
      };
    }
  }
}

export function selectionToSceneSelection(
  selectedItems: SelectedItem[] = [],
): SceneSelection {
  const selection: SceneSelection = {
    projectIds: [],
    worktreeIds: [],
    terminalIds: [],
    cardIds: [],
    annotationIds: [],
  };

  for (const item of selectedItems) {
    switch (item.type) {
      case "project":
        selection.projectIds.push(item.projectId);
        break;
      case "worktree":
        selection.worktreeIds.push(item.worktreeId);
        break;
      case "terminal":
        selection.terminalIds.push(item.terminalId);
        break;
      case "card":
        selection.cardIds.push(item.cardId);
        break;
    }
  }

  return selection;
}

export function createSceneRuntime(
  selection: SelectedItem[] = [],
  renderer: SceneRuntime["renderer"] = "legacy",
): SceneRuntime {
  return {
    renderer,
    selection: selectionToSceneSelection(selection),
  };
}

export function buildSceneDocumentFromLegacyState(
  state: LegacySceneState,
): SceneDocument {
  return {
    version: 2,
    camera: viewportToSceneCamera(state.viewport),
    projects: state.projects ?? [],
    browserCards: state.browserCards ?? {},
    annotations: (state.drawings ?? []).map(drawingToAnnotation),
    stashedTerminals: state.stashedTerminals ?? undefined,
  };
}

export function sceneDocumentToLegacyState(
  scene: SceneDocument,
): {
  viewport: Viewport;
  projects: ProjectData[];
  drawings: DrawingElement[];
  browserCards: Record<string, BrowserCardData>;
  stashedTerminals: StashedTerminal[];
} {
  return {
    viewport: sceneCameraToViewport(scene.camera),
    projects: scene.projects,
    drawings: scene.annotations.map(annotationToDrawing),
    browserCards: scene.browserCards,
    stashedTerminals: scene.stashedTerminals ?? [],
  };
}
