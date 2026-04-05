import test from "node:test";
import assert from "node:assert/strict";

function installSceneDeleteGlobals() {
  const storage = new Map<string, string>();
  const navigator = {
    language: "en-US",
    userAgent: "node-test",
    clipboard: {
      writeText: async () => {},
    },
  };
  const target = new EventTarget();
  const mockWindow = Object.assign(target, {
    navigator,
  }) as Window;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      },
    },
  });

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigator,
  });

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: mockWindow,
  });

  return mockWindow;
}

test("deleteSelectedSceneItems removes selected annotations and cards", async () => {
  const mockWindow = installSceneDeleteGlobals();
  const { useDrawingStore } = await import("../src/stores/drawingStore.ts");
  const { useSelectionStore } = await import("../src/stores/selectionStore.ts");
  const { useBrowserCardStore } = await import("../src/stores/browserCardStore.ts");
  const { deleteSelectedSceneItems } = await import(
    "../src/actions/sceneDeleteActions.ts"
  );

  const previousDrawingState = useDrawingStore.getState();
  const previousSelectionState = useSelectionStore.getState();
  const previousBrowserState = useBrowserCardStore.getState();

  let closedCardId: string | null = null;
  const onClose = (event: Event) => {
    closedCardId = (event as CustomEvent<{ cardId: string }>).detail.cardId;
  };
  mockWindow.addEventListener("termcanvas:close-card", onClose);

  try {
    useDrawingStore.setState({
      tool: "select",
      color: "#ededed",
      elements: [
        {
          id: "annotation-1",
          type: "rect",
          x: 10,
          y: 20,
          w: 100,
          h: 60,
          color: "#fff",
          strokeWidth: 2,
        },
      ],
      activeElement: null,
    });
    useBrowserCardStore.setState({
      cards: {
        "browser-card-1": {
          id: "browser-card-1",
          url: "https://example.com",
          title: "Example",
          x: 10,
          y: 20,
          w: 200,
          h: 100,
        },
      },
    });
    useSelectionStore.setState({
      selectedItems: [
        { type: "annotation", annotationId: "annotation-1" },
        { type: "card", cardId: "browser:browser-card-1" },
        { type: "card", cardId: "file:file-card-1" },
      ],
      selectionRect: null,
    });

    assert.equal(deleteSelectedSceneItems(), true);
    assert.deepEqual(useDrawingStore.getState().elements, []);
    assert.deepEqual(useBrowserCardStore.getState().cards, {});
    assert.equal(closedCardId, "file:file-card-1");
    assert.deepEqual(useSelectionStore.getState().selectedItems, []);
  } finally {
    mockWindow.removeEventListener("termcanvas:close-card", onClose);
    useDrawingStore.setState(previousDrawingState);
    useSelectionStore.setState(previousSelectionState);
    useBrowserCardStore.setState(previousBrowserState);
  }
});
