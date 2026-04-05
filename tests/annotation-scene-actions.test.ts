import test from "node:test";
import assert from "node:assert/strict";

test("annotation scene actions update tool/color and manage annotation elements", async () => {
  const { useDrawingStore } = await import("../src/stores/drawingStore.ts");
  const { useSelectionStore } = await import("../src/stores/selectionStore.ts");
  const {
    addAnnotationToScene,
    clearAnnotationsInScene,
    deleteSelectedAnnotationsInScene,
    removeAnnotationFromScene,
    setAnnotationColorInScene,
    setAnnotationToolInScene,
    setDraftAnnotationInScene,
    updateAnnotationInScene,
  } = await import("../src/actions/annotationSceneActions.ts");

  const previousState = useDrawingStore.getState();
  const previousSelectionState = useSelectionStore.getState();

  try {
    useDrawingStore.setState({
      tool: "select",
      color: "#ededed",
      elements: [],
      activeElement: null,
    });
    useSelectionStore.setState({
      selectedItems: [],
      selectionRect: null,
    });

    setAnnotationToolInScene("rect");
    setAnnotationColorInScene("#0070f3");
    setDraftAnnotationInScene({
      id: "draft-1",
      type: "rect",
      x: 10,
      y: 20,
      w: 0,
      h: 0,
      color: "#0070f3",
      strokeWidth: 2,
    });

    assert.equal(useDrawingStore.getState().tool, "rect");
    assert.equal(useDrawingStore.getState().color, "#0070f3");
    assert.equal(useDrawingStore.getState().activeElement?.id, "draft-1");

    addAnnotationToScene({
      id: "annotation-1",
      type: "rect",
      x: 10,
      y: 20,
      w: 100,
      h: 60,
      color: "#0070f3",
      strokeWidth: 2,
    });

    updateAnnotationInScene("annotation-1", {
      w: 120,
      h: 80,
    });
    assert.deepEqual(useDrawingStore.getState().elements, [
      {
        id: "annotation-1",
        type: "rect",
        x: 10,
        y: 20,
        w: 120,
        h: 80,
        color: "#0070f3",
        strokeWidth: 2,
      },
    ]);
    assert.equal(useDrawingStore.getState().activeElement, null);

    removeAnnotationFromScene("annotation-1");
    assert.deepEqual(useDrawingStore.getState().elements, []);

    addAnnotationToScene({
      id: "annotation-2",
      type: "text",
      x: 40,
      y: 50,
      content: "note",
      color: "#0070f3",
      fontSize: 16,
    });
    useSelectionStore.setState({
      selectedItems: [{ type: "annotation", annotationId: "annotation-2" }],
      selectionRect: null,
    });
    deleteSelectedAnnotationsInScene();
    assert.deepEqual(useDrawingStore.getState().elements, []);
    assert.deepEqual(useSelectionStore.getState().selectedItems, []);

    addAnnotationToScene({
      id: "annotation-3",
      type: "text",
      x: 40,
      y: 50,
      content: "note",
      color: "#0070f3",
      fontSize: 16,
    });
    useSelectionStore.setState({
      selectedItems: [{ type: "annotation", annotationId: "annotation-3" }],
      selectionRect: null,
    });
    clearAnnotationsInScene();
    assert.deepEqual(useDrawingStore.getState().elements, []);
    assert.equal(useDrawingStore.getState().activeElement, null);
    assert.deepEqual(useSelectionStore.getState().selectedItems, []);
  } finally {
    useDrawingStore.setState(previousState);
    useSelectionStore.setState(previousSelectionState);
  }
});
