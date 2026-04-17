import test from "node:test";
import assert from "node:assert/strict";

const STORAGE_KEY = "termcanvas-preferences";

function installLocalStorage(initialValue?: string) {
  const backingStore = new Map<string, string>();
  if (initialValue !== undefined) {
    backingStore.set(STORAGE_KEY, initialValue);
  }

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return backingStore.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        backingStore.set(key, value);
      },
      removeItem(key: string) {
        backingStore.delete(key);
      },
      clear() {
        backingStore.clear();
      },
    },
  });
}

async function loadPreferencesStoreModule(tag: string) {
  return import(`../src/stores/preferencesStore.ts?${tag}`);
}

test("preferences default animation blur is off", async () => {
  installLocalStorage();

  const { usePreferencesStore } = await loadPreferencesStoreModule("default-off");

  assert.equal(usePreferencesStore.getState().animationBlur, 0);
});

test("preferences migrate legacy enabled blur booleans to the legacy intensity", async () => {
  installLocalStorage(JSON.stringify({ animationBlur: true }));

  const { usePreferencesStore } = await loadPreferencesStoreModule("legacy-true");

  assert.equal(usePreferencesStore.getState().animationBlur, 1.5);
});

test("preferences stores and retrieves cliCommands", async () => {
  installLocalStorage();

  const { usePreferencesStore } = await loadPreferencesStoreModule("cli-commands");
  const store = usePreferencesStore.getState();

  assert.deepEqual(store.cliCommands, {});

  store.setCli("claude", { command: "/usr/local/bin/claude", args: [] });
  assert.deepEqual(usePreferencesStore.getState().cliCommands, {
    claude: { command: "/usr/local/bin/claude", args: [] },
  });

  const raw = JSON.parse(localStorage.getItem("termcanvas-preferences")!);
  assert.deepEqual(raw.cliCommands, {
    claude: { command: "/usr/local/bin/claude", args: [] },
  });

  store.setCli("claude", null);
  assert.deepEqual(usePreferencesStore.getState().cliCommands, {});
});

test("preferences ignore removed smart render settings while preserving supported values", async () => {
  installLocalStorage(JSON.stringify({
    smartRenderEnabled: false,
    animationBlur: 1.5,
  }));

  const { usePreferencesStore } = await loadPreferencesStoreModule("smart-render-removed");
  const store = usePreferencesStore.getState();

  assert.equal("smartRenderEnabled" in store, false);
  assert.equal(store.animationBlur, 1.5);

  store.setAnimationBlur(0);

  const raw = JSON.parse(localStorage.getItem("termcanvas-preferences")!);
  assert.equal("smartRenderEnabled" in raw, false);
  assert.equal(raw.animationBlur, 0);
});

test("preferences default terminal size defaults to null (fresh install)", async () => {
  installLocalStorage();
  const { usePreferencesStore } = await loadPreferencesStoreModule(
    "default-terminal-size-fresh",
  );
  assert.equal(usePreferencesStore.getState().defaultTerminalSize, null);
});

test("preferences persist and sanitize defaultTerminalSize", async () => {
  installLocalStorage();
  const { usePreferencesStore } = await loadPreferencesStoreModule(
    "default-terminal-size-set",
  );
  const store = usePreferencesStore.getState();

  // Normal value — writes through.
  store.setDefaultTerminalSize({ w: 820, h: 560 });
  assert.deepEqual(
    usePreferencesStore.getState().defaultTerminalSize,
    { w: 820, h: 560 },
  );
  const persistedA = JSON.parse(localStorage.getItem("termcanvas-preferences")!);
  assert.deepEqual(persistedA.defaultTerminalSize, { w: 820, h: 560 });

  // Fractional values get rounded by the sanitizer.
  store.setDefaultTerminalSize({ w: 640.4, h: 480.9 });
  assert.deepEqual(
    usePreferencesStore.getState().defaultTerminalSize,
    { w: 640, h: 481 },
  );

  // Implausible values are rejected → stored as null so the caller falls
  // back to the panel-aware computed default instead of a broken size.
  store.setDefaultTerminalSize({ w: 10, h: 10 });
  assert.equal(usePreferencesStore.getState().defaultTerminalSize, null);

  // Explicit null resets.
  store.setDefaultTerminalSize({ w: 900, h: 600 });
  store.setDefaultTerminalSize(null);
  assert.equal(usePreferencesStore.getState().defaultTerminalSize, null);
});

test("preferences ignore corrupt defaultTerminalSize on load", async () => {
  installLocalStorage(
    JSON.stringify({
      animationBlur: 0,
      defaultTerminalSize: { w: "huge", h: null },
    }),
  );
  const { usePreferencesStore } = await loadPreferencesStoreModule(
    "default-terminal-size-corrupt",
  );
  assert.equal(usePreferencesStore.getState().defaultTerminalSize, null);
});

