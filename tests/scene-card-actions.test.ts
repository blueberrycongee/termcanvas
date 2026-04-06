import test from "node:test";
import assert from "node:assert/strict";

function installBrowserGlobals() {
  const storage = new Map<string, string>();
  const navigator = {
    language: "en-US",
    userAgent: "node-test",
  };
  const localStorage = {
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
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigator,
  });

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerHeight: 900,
      innerWidth: 1440,
      localStorage,
      navigator,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
      termcanvas: undefined,
    },
  });
}

test("scene card actions create, update, remove, and clear stale card selection", async () => {
  installBrowserGlobals();
  const {
    createBrowserCardInScene,
    removeBrowserCardFromScene,
    updateBrowserCardInScene,
  } = await import("../src/actions/sceneCardActions.ts");
  const { useBrowserCardStore } = await import("../src/stores/browserCardStore.ts");
  const { useSelectionStore } = await import("../src/stores/selectionStore.ts");

  const previousBrowserState = useBrowserCardStore.getState();
  const previousSelectionState = useSelectionStore.getState();

  try {
    useBrowserCardStore.setState({ cards: {} });
    useSelectionStore.setState({ selectedItems: [] });

    const cardId = createBrowserCardInScene("https://example.com", {
      x: 100,
      y: 120,
    });

    updateBrowserCardInScene(cardId, {
      title: "Example",
      w: 480,
    });

    useSelectionStore.getState().setSelectedItems([
      {
        type: "card",
        cardId: `browser:${cardId}`,
      },
    ]);

    assert.deepEqual(useBrowserCardStore.getState().cards[cardId], {
      id: cardId,
      title: "Example",
      url: "https://example.com",
      x: 100,
      y: 120,
      w: 480,
      h: 600,
    });

    removeBrowserCardFromScene(cardId);

    assert.deepEqual(useBrowserCardStore.getState().cards, {});
    assert.deepEqual(useSelectionStore.getState().selectedItems, []);
  } finally {
    useSelectionStore.setState(previousSelectionState);
    useBrowserCardStore.setState(previousBrowserState);
  }
});

test("browserCardStore.removeCard clears prefixed card selections", async () => {
  installBrowserGlobals();
  const { useBrowserCardStore } = await import("../src/stores/browserCardStore.ts");
  const { useSelectionStore } = await import("../src/stores/selectionStore.ts");

  const previousBrowserState = useBrowserCardStore.getState();
  const previousSelectionState = useSelectionStore.getState();

  try {
    useBrowserCardStore.setState({
      cards: {
        "browser-card-1": {
          id: "browser-card-1",
          title: "Example",
          url: "https://example.com",
          x: 0,
          y: 0,
          w: 320,
          h: 240,
        },
      },
    });
    useSelectionStore.setState({
      selectedItems: [{ type: "card", cardId: "browser:browser-card-1" }],
      selectionRect: null,
    });

    useBrowserCardStore.getState().removeCard("browser-card-1");

    assert.deepEqual(useBrowserCardStore.getState().cards, {});
    assert.deepEqual(useSelectionStore.getState().selectedItems, []);
  } finally {
    useSelectionStore.setState(previousSelectionState);
    useBrowserCardStore.setState(previousBrowserState);
  }
});
