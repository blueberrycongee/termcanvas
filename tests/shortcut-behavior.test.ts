import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { shouldIgnoreShortcutTarget } from "../src/hooks/shortcutTarget.ts";
import { navigateToTerminalWithViewport } from "../src/hooks/useKeyboardShortcuts.ts";
import {
  DEFAULT_SHORTCUTS,
  eventToShortcut,
  getDefaultShortcuts,
  isRegisteredAppShortcutEvent,
  matchesShortcut,
  useShortcutStore,
} from "../src/stores/shortcutStore.ts";
import { isSelectAllShortcutInput } from "../electron/select-all-shortcut.ts";
import {
  isXtermHelperTextArea,
  performContextualSelectAll,
  selectAllInTarget,
} from "../src/utils/contextualSelectAll.ts";
import { getTerminalFocusOrder } from "../src/stores/projectFocus.ts";
import {
  createTerminalSelectionAutoCopyState,
  markTerminalSelectionChanged,
  markTerminalSelectionCopied,
  markTerminalSelectionPointerEnded,
  markTerminalSelectionPointerStarted,
  shouldAutoCopyTerminalSelection,
} from "../src/terminal/selectionAutoCopy.ts";
import {
  isPanModeActive,
  useCanvasToolStore,
} from "../src/stores/canvasToolStore.ts";
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

function createTargetWithClass(
  tagName: string,
  className: string,
): EventTarget {
  return {
    tagName,
    classList: {
      contains(token: string) {
        return token === className;
      },
    },
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

test("registered app shortcuts are recognized on Windows", () => {
  withPlatform("win32", () => {
    assert.equal(
      isRegisteredAppShortcutEvent(
        createKeyboardEvent({ key: "t", altKey: true }),
        getDefaultShortcuts("win32"),
      ),
      true,
    );
    assert.equal(
      isRegisteredAppShortcutEvent(
        createKeyboardEvent({ key: "c", ctrlKey: true }),
      ),
      false,
    );
  });
});

test("customized shortcuts are recognized as app shortcuts", () => {
  const previousShortcuts = useShortcutStore.getState().shortcuts;
  useShortcutStore.setState({
    shortcuts: {
      ...previousShortcuts,
      newTerminal: "mod+shift+n",
    },
  });

  try {
    withPlatform("win32", () => {
      assert.equal(
        isRegisteredAppShortcutEvent(
          createKeyboardEvent({ key: "n", ctrlKey: true, shiftKey: true }),
        ),
        true,
      );
      assert.equal(
        isRegisteredAppShortcutEvent(
          createKeyboardEvent({ key: "t", ctrlKey: true }),
        ),
        false,
      );
    });
  } finally {
    useShortcutStore.setState({ shortcuts: previousShortcuts });
  }
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

test("editable targets allow alt shortcuts to reach the app on Windows", () => {
  withPlatform("win32", () => {
    assert.equal(
      shouldIgnoreShortcutTarget(
        createKeyboardEvent({
          target: createTarget("TEXTAREA"),
          altKey: true,
        }),
      ),
      false,
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

test("canvas tool defaults to hand for canvas navigation", () => {
  assert.equal(useCanvasToolStore.getState().tool, "hand");
  assert.equal(isPanModeActive(), true);
});

test("canvas pan mode is explicit via hand tool or Space hold", () => {
  useCanvasToolStore.setState({ tool: "hand", spaceHeld: false });
  assert.equal(isPanModeActive(), true);

  useCanvasToolStore.setState({ tool: "select", spaceHeld: true });
  assert.equal(isPanModeActive(), true);

  useCanvasToolStore.setState({ tool: "hand", spaceHeld: false });
});

test("terminal cursor CSS opts out of canvas pan cursor inheritance", () => {
  const css = fs.readFileSync("src/index.css", "utf-8");

  assert.match(css, /\.terminal-tile\s*\{[^}]*cursor:\s*default;/s);
  assert.match(css, /\.tc-xterm-host,[\s\S]*cursor:\s*text !important;/);
  assert.doesNotMatch(
    css,
    /body\.tc-canvas-pan-(?:mode|grabbing)[^{]*\{[^}]*cursor:\s*(?:grab|grabbing) !important;/s,
  );
});

test("select-all shortcut detection only matches the platform primary modifier", () => {
  assert.equal(
    isSelectAllShortcutInput(
      {
        type: "keyDown",
        key: "a",
        meta: true,
        control: false,
        alt: false,
        shift: false,
      },
      "darwin",
    ),
    true,
  );
  assert.equal(
    isSelectAllShortcutInput(
      {
        type: "keyDown",
        key: "a",
        meta: false,
        control: true,
        alt: false,
        shift: false,
      },
      "darwin",
    ),
    false,
  );
  assert.equal(
    isSelectAllShortcutInput(
      {
        type: "keyDown",
        key: "A",
        meta: false,
        control: true,
        alt: false,
        shift: false,
      },
      "win32",
    ),
    true,
  );
  assert.equal(
    isSelectAllShortcutInput(
      {
        type: "keyDown",
        key: "a",
        meta: false,
        control: true,
        alt: true,
        shift: false,
      },
      "win32",
    ),
    false,
  );
});

test("contextual select-all uses native selection for regular text inputs", () => {
  let selected = false;
  const result = performContextualSelectAll(
    {
      tagName: "TEXTAREA",
      select() {
        selected = true;
      },
    } as unknown as EventTarget,
    () => false,
  );

  assert.equal(result, "target");
  assert.equal(selected, true);
});

test("contextual select-all routes xterm helper textarea to the terminal", () => {
  let terminalSelected = 0;
  const target = createTargetWithClass("TEXTAREA", "xterm-helper-textarea");

  assert.equal(isXtermHelperTextArea(target), true);
  assert.equal(selectAllInTarget(target), false);
  assert.equal(
    performContextualSelectAll(target, () => {
      terminalSelected += 1;
      return true;
    }),
    "terminal",
  );
  assert.equal(terminalSelected, 1);
});

test("contextual select-all selects contenteditable contents", () => {
  let selectedNode: unknown = null;
  let addedRange: unknown = null;
  const target = {
    isContentEditable: true,
    ownerDocument: {
      createRange() {
        return {
          selectNodeContents(node: unknown) {
            selectedNode = node;
          },
        };
      },
      getSelection() {
        return {
          addRange(range: unknown) {
            addedRange = range;
          },
          removeAllRanges() {},
        };
      },
    },
  } as unknown as EventTarget;

  assert.equal(performContextualSelectAll(target, () => false), "target");
  assert.equal(selectedNode, target);
  assert.notEqual(addedRange, null);
});

test("terminal auto-copy only fires after a pointer-completed selection", () => {
  let state = createTerminalSelectionAutoCopyState();

  state = markTerminalSelectionPointerStarted(state);
  state = markTerminalSelectionChanged(state);
  assert.equal(
    shouldAutoCopyTerminalSelection(state, "selected text", "selectionchange"),
    false,
  );
  assert.equal(
    shouldAutoCopyTerminalSelection(state, "selected text", "mouseup"),
    true,
  );

  state = markTerminalSelectionCopied(state);
  state = markTerminalSelectionPointerEnded(state);
  assert.equal(
    shouldAutoCopyTerminalSelection(state, "selected text", "mouseup"),
    false,
  );

  state = markTerminalSelectionChanged(state);
  assert.equal(
    shouldAutoCopyTerminalSelection(state, "selected text", "selectionchange"),
    false,
  );
  assert.equal(
    shouldAutoCopyTerminalSelection(state, "selected text", "mouseup"),
    false,
  );
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

test("Windows defaults use alt-based shortcuts", () => {
  withPlatform("win32", () => {
    const defaults = getDefaultShortcuts();
    assert.equal(defaults.newTerminal, "alt+t");
    assert.equal(defaults.saveWorkspace, "alt+s");
    assert.equal(defaults.toggleRightPanel, "alt+/");
  });
});

test("resetAll restores platform defaults on Windows", () => {
  const previousShortcuts = useShortcutStore.getState().shortcuts;
  const previousStorage = globalThis.localStorage;
  const storage = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => storage.clear(),
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  } as Storage;

  try {
    withPlatform("win32", () => {
      useShortcutStore.getState().setShortcut("newTerminal", "mod+t");
      useShortcutStore.getState().resetAll();
      assert.equal(useShortcutStore.getState().shortcuts.newTerminal, "alt+t");
    });
  } finally {
    useShortcutStore.setState({ shortcuts: previousShortcuts });
    if (previousStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage?: Storage }).localStorage = previousStorage;
    }
  }
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

test("terminal navigation re-zooms to the target tile when not in zoomed-out mode", () => {
  const pans: Array<{ terminalId: string; preserveScale?: boolean }> = [];
  const zooms: string[] = [];

  const nextZoomedOutId = navigateToTerminalWithViewport("terminal-2", {
    zoomedOutTerminalId: null,
    pan: (terminalId, options) => {
      pans.push({
        terminalId,
        preserveScale: options?.preserveScale,
      });
    },
    zoom: (terminalId) => {
      zooms.push(terminalId);
    },
  });

  assert.equal(nextZoomedOutId, null);
  assert.deepEqual(zooms, ["terminal-2"]);
  assert.deepEqual(pans, []);
});

test("terminal navigation preserves scale only while zoomed out", () => {
  const pans: Array<{ terminalId: string; preserveScale?: boolean }> = [];
  const zooms: string[] = [];

  const nextZoomedOutId = navigateToTerminalWithViewport("terminal-2", {
    zoomedOutTerminalId: "terminal-1",
    pan: (terminalId, options) => {
      pans.push({
        terminalId,
        preserveScale: options?.preserveScale,
      });
    },
    zoom: (terminalId) => {
      zooms.push(terminalId);
    },
  });

  assert.equal(nextZoomedOutId, "terminal-2");
  assert.deepEqual(zooms, []);
  assert.deepEqual(pans, [
    {
      terminalId: "terminal-2",
      preserveScale: true,
    },
  ]);
});
