import {
  useDrawingStore,
  type DrawingElement,
  type DrawingTool,
} from "../stores/drawingStore";
import { useSelectionStore } from "../stores/selectionStore";

export function setAnnotationToolInScene(tool: DrawingTool): void {
  useDrawingStore.getState().setTool(tool);
}

export function setAnnotationColorInScene(color: string): void {
  useDrawingStore.getState().setColor(color);
}

export function setDraftAnnotationInScene(
  element: DrawingElement | null,
): void {
  useDrawingStore.getState().setActiveElement(element);
}

export function addAnnotationToScene(element: DrawingElement): void {
  useDrawingStore.getState().addElement(element);
}

export function updateAnnotationInScene(
  id: string,
  partial: Partial<DrawingElement>,
): void {
  useDrawingStore.getState().updateElement(id, partial);
}

export function removeAnnotationFromScene(id: string): void {
  useDrawingStore.getState().removeElement(id);
  useSelectionStore.setState((state) => ({
    selectedItems: state.selectedItems.filter(
      (item) => item.type !== "annotation" || item.annotationId !== id,
    ),
  }));
}

export function clearAnnotationsInScene(): void {
  useDrawingStore.getState().clearAll();
  useSelectionStore.setState((state) => ({
    selectedItems: state.selectedItems.filter(
      (item) => item.type !== "annotation",
    ),
  }));
}

export function deleteSelectedAnnotationsInScene(): void {
  const selectedAnnotations = useSelectionStore
    .getState()
    .selectedItems.flatMap((item) =>
      item.type === "annotation" ? [item.annotationId] : [],
    );

  if (selectedAnnotations.length === 0) {
    return;
  }

  const { removeElement } = useDrawingStore.getState();
  for (const annotationId of selectedAnnotations) {
    removeElement(annotationId);
  }
  useSelectionStore.setState((state) => ({
    selectedItems: state.selectedItems.filter(
      (item) => item.type !== "annotation",
    ),
  }));
}
