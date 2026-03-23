import test from "node:test";
import assert from "node:assert/strict";

import { shouldIgnoreShortcutTarget } from "../src/hooks/shortcutTarget.ts";
import {
  DEFAULT_SHORTCUTS,
  eventToShortcut,
  matchesShortcut,
} from "../src/stores/shortcutStore.ts";
import { getTerminalFocusOrder } from "../src/stores/projectFocus.ts";
import type { ProjectData } from "../src/types/index.ts";

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

test("rename title shortcut defaults to mod+semicolon", () => {
  assert.equal(DEFAULT_SHORTCUTS.renameTerminalTitle, "mod+;");
});

test("cycle focus level shortcut defaults to mod+g and matches correctly", () => {
  assert.equal(DEFAULT_SHORTCUTS.cycleFocusLevel, "mod+g");

  withPlatform("darwin", () => {
    assert.equal(
      matchesShortcut(createKeyboardEvent({ key: "g", metaKey: true }), "mod+g"),
      true,
    );
  });
});

test("terminal focus order follows natural project/worktree/array order", () => {
  const projects: ProjectData[] = [
    {
      id: "project-1",
      name: "Project One",
      path: "/tmp/project-1",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 1,
      worktrees: [
        {
          id: "worktree-1",
          name: "main",
          path: "/tmp/project-1",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "terminal-1",
              title: "Terminal 1",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: 101,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
            {
              id: "terminal-2",
              title: "Terminal 2",
              type: "codex",
              minimized: false,
              focused: false,
              ptyId: 102,
              status: "idle",
              span: { cols: 1, rows: 1 },
              parentTerminalId: "terminal-1",
            },
            {
              id: "terminal-3",
              title: "Terminal 3",
              type: "claude",
              minimized: false,
              focused: false,
              ptyId: 103,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
        {
          id: "worktree-2",
          name: "feature",
          path: "/tmp/project-1-feature",
          position: { x: 0, y: 200 },
          collapsed: false,
          terminals: [
            {
              id: "terminal-4",
              title: "Terminal 4",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: 104,
              status: "idle",
              span: { cols: 1, rows: 1 },
              parentTerminalId: "terminal-2",
            },
          ],
        },
      ],
    },
  ];

  assert.deepEqual(
    getTerminalFocusOrder(projects).map((terminal) => terminal.terminalId),
    ["terminal-1", "terminal-2", "terminal-3", "terminal-4"],
  );
});
