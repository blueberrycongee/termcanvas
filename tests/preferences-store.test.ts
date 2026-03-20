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

  // Defaults to empty
  assert.deepEqual(store.cliCommands, {});

  // Set a CLI command
  store.setCli("claude", { command: "/usr/local/bin/claude", args: [] });
  assert.deepEqual(usePreferencesStore.getState().cliCommands, {
    claude: { command: "/usr/local/bin/claude", args: [] },
  });

  // Persists to localStorage
  const raw = JSON.parse(localStorage.getItem("termcanvas-preferences")!);
  assert.deepEqual(raw.cliCommands, {
    claude: { command: "/usr/local/bin/claude", args: [] },
  });

  // Clear by passing null
  store.setCli("claude", null);
  assert.deepEqual(usePreferencesStore.getState().cliCommands, {});
});
