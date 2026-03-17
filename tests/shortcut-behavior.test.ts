import test from "node:test";
import assert from "node:assert/strict";

import { shouldIgnoreShortcutTarget } from "../src/hooks/shortcutTarget.ts";
import { eventToShortcut, matchesShortcut } from "../src/stores/shortcutStore.ts";

function withPlatform(
  platform: "darwin" | "win32" | "linux",
  run: () => void,
) {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    termcanvas: {
      app: { platform },
    },
  };

  try {
    run();
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
}

function createKeyboardEvent(
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key: "b",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    ...overrides,
  } as KeyboardEvent;
}

function createTarget(
  tagName: string,
  isContentEditable: boolean = false,
): EventTarget {
  return {
    tagName,
    isContentEditable,
  } as unknown as EventTarget;
}

test("matchesShortcut uses command as mod on macOS", () => {
  withPlatform("darwin", () => {
    assert.equal(
      matchesShortcut(createKeyboardEvent({ metaKey: true }), "mod+b"),
      true,
    );
    assert.equal(
      matchesShortcut(createKeyboardEvent({ ctrlKey: true }), "mod+b"),
      false,
    );
  });
});

test("eventToShortcut ignores ctrl-only combos on macOS", () => {
  withPlatform("darwin", () => {
    assert.equal(eventToShortcut(createKeyboardEvent({ ctrlKey: true })), "");
    assert.equal(eventToShortcut(createKeyboardEvent({ metaKey: true })), "mod+b");
  });
});

test("matchesShortcut uses ctrl as mod on Windows", () => {
  withPlatform("win32", () => {
    assert.equal(
      matchesShortcut(createKeyboardEvent({ ctrlKey: true }), "mod+b"),
      true,
    );
    assert.equal(
      matchesShortcut(createKeyboardEvent({ metaKey: true }), "mod+b"),
      false,
    );
  });
});

test("editable targets still ignore plain typing shortcuts", () => {
  withPlatform("darwin", () => {
    assert.equal(
      shouldIgnoreShortcutTarget(
        createKeyboardEvent({ target: createTarget("TEXTAREA") }),
      ),
      true,
    );
  });
});

test("editable targets allow command shortcuts to reach the app on macOS", () => {
  withPlatform("darwin", () => {
    assert.equal(
      shouldIgnoreShortcutTarget(
        createKeyboardEvent({
          target: createTarget("TEXTAREA"),
          metaKey: true,
        }),
      ),
      false,
    );
    assert.equal(
      shouldIgnoreShortcutTarget(
        createKeyboardEvent({
          target: createTarget("TEXTAREA"),
          ctrlKey: true,
        }),
      ),
      true,
    );
  });
});
