import { removeAnnotationFromScene } from "./annotationSceneActions";
import { removeBrowserCardFromScene } from "./sceneCardActions";
import { useSelectionStore } from "../stores/selectionStore";

export function deleteSelectedSceneItems(): boolean {
  const selectedItems = useSelectionStore.getState().selectedItems;
  let deleted = false;

  for (const item of selectedItems) {
    if (item.type === "annotation") {
      removeAnnotationFromScene(item.annotationId);
      deleted = true;
      continue;
    }

    if (item.type === "card") {
      if (item.cardId.startsWith("browser:")) {
        removeBrowserCardFromScene(item.cardId.slice("browser:".length));
      } else {
        window.dispatchEvent(
          new CustomEvent("termcanvas:close-card", {
            detail: { cardId: item.cardId },
          }),
        );
      }
      deleted = true;
    }
  }

  if (deleted) {
    useSelectionStore.setState((state) => ({
      selectedItems: state.selectedItems.filter(
        (item) => item.type !== "annotation" && item.type !== "card",
      ),
    }));
  }

  return deleted;
}
