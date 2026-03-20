# Save Mechanism Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add proper Save / Save-As / auto-save semantics, graceful PTY shutdown, and atomic state persistence to TermCanvas.

**Architecture:** Introduce a `workspaceStore` for document state (path, dirty flag). Wire event-based dirty tracking into existing stores. Add debounced auto-save to `state.json`. Refactor close/save flows to follow standard document-app conventions (Cmd+S / Cmd+Shift+S). Make PTY shutdown graceful (SIGTERM → wait → SIGKILL).

**Tech Stack:** TypeScript, Zustand, Electron IPC, node-pty, node:test

**Design doc:** `docs/plans/2026-03-20-save-mechanism-refactor-design.md`

---

### Task 1: Atomic state.json writes

**Files:**
- Modify: `electron/state-persistence.ts:30-32`
- Test: `tests/state-persistence.test.ts` (new)

**Step 1: Write the failing test**

Create `tests/state-persistence.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

test("save writes atomically via tmp+rename", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-state-"));
  const file = path.join(dir, "state.json");

  // Manually import and patch the class to use our temp dir
  // We test the logic directly: write tmp, rename
  const data = { version: 1, projects: [] };
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, file);

  const loaded = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.deepEqual(loaded, data);
  assert.equal(fs.existsSync(tmp), false, "tmp file should be cleaned up by rename");

  // Cleanup
  fs.rmSync(dir, { recursive: true });
});

test("save with skipRestore flag", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-state-"));
  const file = path.join(dir, "state.json");

  const data = { version: 1, projects: [], skipRestore: true };
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, file);

  const loaded = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(loaded.skipRestore, true);

  fs.rmSync(dir, { recursive: true });
});
```

**Step 2: Run test to verify it passes** (this tests the pattern, not the class yet)

Run: `node --experimental-strip-types --test tests/state-persistence.test.ts`
Expected: PASS

**Step 3: Update StatePersistence to use atomic writes**

In `electron/state-persistence.ts:30-32`, replace:

```ts
  save(state: unknown) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  }
```

with:

```ts
  save(state: unknown) {
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmp, STATE_FILE);
  }
```

**Step 4: Run full test suite**

Run: `npm test`
Expected: all PASS

**Step 5: Commit**

```
git add electron/state-persistence.ts tests/state-persistence.test.ts
git commit -m "feat: atomic state.json writes via tmp+rename"
```

---

### Task 2: Graceful PTY shutdown

**Files:**
- Modify: `electron/pty-manager.ts:119-132`
- Modify: `electron/main.ts:194-196` (terminal:destroy handler)
- Modify: `electron/main.ts:695-704` (app:close-confirmed handler)

**Step 1: Make `destroy()` async with SIGTERM → wait → SIGKILL**

In `electron/pty-manager.ts`, replace lines 119-132:

```ts
  destroy(id: number) {
    const instance = this.instances.get(id);
    if (instance) {
      instance.kill();
      this.instances.delete(id);
    }
    this.outputBuffers.delete(id);
  }

  destroyAll() {
    for (const [id] of this.instances) {
      this.destroy(id);
    }
  }
```

with:

```ts
  async destroy(id: number): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      this.outputBuffers.delete(id);
      return;
    }
    const pid = instance.pid;
    this.instances.delete(id);
    this.outputBuffers.delete(id);

    // Graceful: SIGTERM first, then wait up to 5s
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return; // already gone
    }

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        return; // exited
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    // Still alive → force kill
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }

  async destroyAll(): Promise<void> {
    const ids = [...this.instances.keys()];
    await Promise.all(ids.map((id) => this.destroy(id)));
  }
```

**Step 2: Update `terminal:destroy` IPC handler to await**

In `electron/main.ts:194-196`, change:

```ts
  ipcMain.handle("terminal:destroy", (_event, ptyId: number) => {
    ptyManager.destroy(ptyId);
  });
```

to:

```ts
  ipcMain.handle("terminal:destroy", async (_event, ptyId: number) => {
    await ptyManager.destroy(ptyId);
  });
```

**Step 3: Update `app:close-confirmed` handler to await**

In `electron/main.ts:695-704`, change:

```ts
  ipcMain.on("app:close-confirmed", () => {
    ptyManager.destroyAll();
    gitWatcher.unwatchAll();
    sessionWatcher.unwatchAll();
    forceClose = true;
    if (mainWindow) {
      mainWindow.close();
    }
    app.quit();
  });
```

to:

```ts
  ipcMain.on("app:close-confirmed", async () => {
    await ptyManager.destroyAll();
    gitWatcher.unwatchAll();
    sessionWatcher.unwatchAll();
    forceClose = true;
    if (mainWindow) {
      mainWindow.close();
    }
    app.quit();
  });
```

**Step 4: Run full test suite**

Run: `npm test`
Expected: all PASS

**Step 5: Commit**

```
git add electron/pty-manager.ts electron/main.ts
git commit -m "feat: graceful PTY shutdown (SIGTERM → 5s → SIGKILL)"
```

---

### Task 3: Workspace store + new IPC endpoints

**Files:**
- Create: `src/stores/workspaceStore.ts`
- Modify: `electron/main.ts` (add `workspace:save-to-path` and `workspace:set-title` IPC handlers)
- Modify: `electron/preload.ts` (expose new IPC)

**Step 1: Create workspaceStore**

Create `src/stores/workspaceStore.ts`:

```ts
import { create } from "zustand";

interface WorkspaceStore {
  workspacePath: string | null;
  dirty: boolean;
  lastSavedAt: number | null;
  setWorkspacePath: (path: string | null) => void;
  markDirty: () => void;
  markClean: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspacePath: null,
  dirty: false,
  lastSavedAt: null,

  setWorkspacePath: (path) => set({ workspacePath: path }),

  markDirty: () =>
    set((state) => (state.dirty ? state : { dirty: true })),

  markClean: () => set({ dirty: false, lastSavedAt: Date.now() }),
}));
```

**Step 2: Add `workspace:save-to-path` IPC handler**

In `electron/main.ts`, after the existing `workspace:save` handler (~line 457), add:

```ts
  ipcMain.handle(
    "workspace:save-to-path",
    (_event, filePath: string, data: string) => {
      fs.writeFileSync(filePath, data, "utf-8");
    },
  );

  ipcMain.handle("workspace:set-title", (_event, title: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(title);
    }
  });
```

**Step 3: Expose in preload**

In `electron/preload.ts`, inside the `workspace` object (~line 99-103), add after `open`:

```ts
    saveToPath: (filePath: string, data: string) =>
      ipcRenderer.invoke("workspace:save-to-path", filePath, data) as Promise<void>,
    setTitle: (title: string) =>
      ipcRenderer.invoke("workspace:set-title", title) as Promise<void>,
```

**Step 4: Run full test suite**

Run: `npm test`
Expected: all PASS

**Step 5: Commit**

```
git add src/stores/workspaceStore.ts electron/main.ts electron/preload.ts
git commit -m "feat: add workspaceStore and save-to-path/set-title IPC"
```

---

### Task 4: Wire dirty tracking into stores

**Files:**
- Modify: `src/stores/projectStore.ts`
- Modify: `src/stores/drawingStore.ts`
- Modify: `src/stores/browserCardStore.ts`
- Modify: `src/stores/canvasStore.ts`

**Step 1: Add markDirty to projectStore**

In `src/stores/projectStore.ts`, add import at top:

```ts
import { useWorkspaceStore } from "./workspaceStore";
```

Then add a helper after the imports:

```ts
function markDirty() {
  useWorkspaceStore.getState().markDirty();
}
```

Call `markDirty()` at the end of these store actions (the ones that represent user-intent mutations):
- `addProject` — after `set(...)` call
- `removeProject` — after `set(...)` call
- `updateProjectPosition` — after `set(...)` call
- `toggleProjectCollapse` — after `set(...)` call
- `updateWorktreePosition` — after `set(...)` call
- `toggleWorktreeCollapse` — after `set(...)` call
- `removeWorktree` — after `set(...)` call
- `addTerminal` — after `set(...)` call
- `removeTerminal` — after `set(...)` call
- `toggleTerminalMinimize` — after `set(...)` call
- `updateTerminalSpan` — after `set(...)` call
- `reorderTerminal` — after `set(...)` call
- `setProjects` — after `set(...)` call

Do **NOT** add `markDirty()` to these (runtime-only):
- `updateTerminalPtyId`
- `updateTerminalStatus`
- `updateTerminalSessionId`
- `updateTerminalType`
- `updateTerminalCustomTitle`
- `setFocusedTerminal`
- `setFocusedWorktree`
- `clearFocus`
- `bringToFront`

The pattern for each action: find the `set(...)` call and add `markDirty();` right after the closing `)` of the `set` call. For actions that use `set((state) => ...)`, the `markDirty()` goes after the `set(...)` call returns (zustand `set` is synchronous).

**Step 2: Add markDirty to drawingStore**

In `src/stores/drawingStore.ts`, add import:

```ts
import { useWorkspaceStore } from "./workspaceStore";
```

Add `markDirty()` helper and call it at the end of: `addElement`, `updateElement`, `removeElement`, `clearAll`.

Do **NOT** add to: `setTool`, `setColor`, `setActiveElement` (UI-only state).

**Step 3: Add markDirty to browserCardStore**

In `src/stores/browserCardStore.ts`, add import:

```ts
import { useWorkspaceStore } from "./workspaceStore";
```

Add `markDirty()` helper and call it at the end of: `addCard`, `removeCard`, `updateCard`.

**Step 4: Add markDirty to canvasStore**

In `src/stores/canvasStore.ts`, add import:

```ts
import { useWorkspaceStore } from "./workspaceStore";
```

Add `markDirty()` helper and call it in `setViewport` only. Do **NOT** add to `animateTo` (it calls `setViewport` indirectly via `set`), `resetViewport`, `setSidebarCollapsed`, `setRightPanelCollapsed` (UI-only).

Actually, for `canvasStore`, viewport changes happen continuously during drag. Better to call `markDirty()` in `setViewport` — the `markDirty` implementation already no-ops when already dirty, so this is safe.

**Step 5: Run full test suite**

Run: `npm test`
Expected: all PASS

**Step 6: Commit**

```
git add src/stores/projectStore.ts src/stores/drawingStore.ts src/stores/browserCardStore.ts src/stores/canvasStore.ts
git commit -m "feat: wire event-based dirty tracking into all stores"
```

---

### Task 5: Keyboard shortcuts for Save / Save As

**Files:**
- Modify: `src/stores/shortcutStore.ts:4-16, 18-32`
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

**Step 1: Add shortcuts to ShortcutMap and defaults**

In `src/stores/shortcutStore.ts`, add to the `ShortcutMap` interface (after line 16, before the closing `}`):

```ts
  saveWorkspace: string;
  saveWorkspaceAs: string;
```

Add to `DEFAULT_SHORTCUTS` (after line 31, before the closing `}`):

```ts
  saveWorkspace: "mod+s",
  saveWorkspaceAs: "mod+shift+s",
```

**Step 2: Add i18n entries**

In `src/i18n/en.ts`, add after line 100 (`shortcut_span_large`):

```ts
  shortcut_save_workspace: "Save",
  shortcut_save_workspace_as: "Save As",
  save_as: "Save As",
  save_error: (err: string) => `Save failed: ${err}`,
```

In `src/i18n/zh.ts`, add after line 98 (`shortcut_span_large`):

```ts
  shortcut_save_workspace: "保存",
  shortcut_save_workspace_as: "另存为",
  save_as: "另存为",
  save_error: (err: string) => `保存失败：${err}`,
```

**Step 3: Add save/saveAs handlers in useKeyboardShortcuts**

In `src/hooks/useKeyboardShortcuts.ts`, add imports at top:

```ts
import { useWorkspaceStore } from "../stores/workspaceStore";
```

Find where shortcuts are handled (the `useEffect` with the keydown listener). Add a `saveWorkspace` function and wire two new shortcut matches. The save logic:

```ts
    // Save workspace (Cmd+S)
    if (matchesShortcut(e, shortcuts.saveWorkspace)) {
      e.preventDefault();
      const snap = snapshotState();
      const { workspacePath } = useWorkspaceStore.getState();
      if (workspacePath) {
        window.termcanvas.workspace.saveToPath(workspacePath, snap).then(() => {
          window.termcanvas.state.save(JSON.parse(snap));
          useWorkspaceStore.getState().markClean();
          updateTitle();
        }).catch((err) => {
          notify("error", t.save_error(String(err)));
        });
      } else {
        window.termcanvas.workspace.save(snap).then((saved) => {
          if (saved) {
            window.termcanvas.state.save(JSON.parse(snap));
            // workspacePath is set by the save dialog response — need IPC
            useWorkspaceStore.getState().markClean();
            updateTitle();
          }
        });
      }
      return;
    }

    // Save As (Cmd+Shift+S)
    if (matchesShortcut(e, shortcuts.saveWorkspaceAs)) {
      e.preventDefault();
      const snap = snapshotState();
      window.termcanvas.workspace.save(snap).then((saved) => {
        if (saved) {
          window.termcanvas.state.save(JSON.parse(snap));
          useWorkspaceStore.getState().markClean();
          updateTitle();
        }
      });
      return;
    }
```

Note: `snapshotState` and `updateTitle` need to be importable. `snapshotState` is currently a local function in `App.tsx`. It should be extracted to a shared module. See Task 6.

**Step 4: Run full test suite**

Run: `npm test`
Expected: all PASS

**Step 5: Commit**

```
git add src/stores/shortcutStore.ts src/hooks/useKeyboardShortcuts.ts src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat: add Cmd+S / Cmd+Shift+S save shortcuts"
```

---

### Task 6: Extract snapshotState + refactor save/close flow in App.tsx

This is the largest task. It refactors the close handler and adds the auto-save hook.

**Files:**
- Modify: `src/App.tsx:54-82` (extract snapshotState)
- Modify: `src/App.tsx:167-213` (refactor useCloseHandler)
- Modify: `src/App.tsx:139-165` (useStatePersistence, useWorkspaceOpen)
- Modify: `src/App.tsx:258-265` (App component)

**Step 1: Extract snapshotState to a shared module**

Create `src/snapshotState.ts`:

```ts
import { useProjectStore } from "./stores/projectStore";
import { useCanvasStore } from "./stores/canvasStore";
import { useDrawingStore } from "./stores/drawingStore";
import { useBrowserCardStore } from "./stores/browserCardStore";
import { serializeAllTerminals } from "./terminal/terminalRegistry";

export function snapshotState(): string {
  const scrollbacks = serializeAllTerminals();
  const projects = useProjectStore.getState().projects.map((p) => ({
    ...p,
    worktrees: p.worktrees.map((wt) => ({
      ...wt,
      terminals: wt.terminals.map((t) => ({
        ...t,
        scrollback: scrollbacks[t.id] ?? t.scrollback ?? undefined,
        ptyId: null,
      })),
    })),
  }));

  return JSON.stringify(
    {
      version: 1,
      viewport: useCanvasStore.getState().viewport,
      projects,
      drawings: useDrawingStore.getState().elements,
      browserCards: useBrowserCardStore.getState().cards,
    },
    null,
    2,
  );
}
```

In `src/App.tsx`, remove the local `snapshotState` function (lines 54-82) and replace with:

```ts
import { snapshotState } from "./snapshotState";
```

**Step 2: Add title update helper**

Create helper in `src/titleHelper.ts`:

```ts
import { useWorkspaceStore } from "./stores/workspaceStore";

export function updateWindowTitle() {
  const { workspacePath, dirty } = useWorkspaceStore.getState();
  const name = workspacePath
    ? workspacePath.split("/").pop()?.replace(/\.termcanvas$/, "") ?? "Untitled"
    : "Untitled";
  const title = `${dirty ? "* " : ""}${name} — TermCanvas`;
  window.termcanvas?.workspace.setTitle(title);
}
```

**Step 3: Add useAutoSave hook**

Add in `src/App.tsx` (new hook):

```ts
function useAutoSave() {
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let backstopTimer: ReturnType<typeof setInterval> | null = null;

    const unsubscribe = useWorkspaceStore.subscribe((state, prev) => {
      if (state.dirty && !prev.dirty) {
        // Dirty just became true — start debounce
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const snap = snapshotState();
          window.termcanvas.state.save(JSON.parse(snap));
          useWorkspaceStore.getState().markClean();
          updateWindowTitle();
        }, 5000);
      }
      if (!state.dirty && prev.dirty) {
        // Just became clean (user saved) — cancel pending debounce
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
      }
    });

    // 60s backstop: save if dirty for too long
    backstopTimer = setInterval(() => {
      const { dirty, lastSavedAt } = useWorkspaceStore.getState();
      if (dirty && (!lastSavedAt || Date.now() - lastSavedAt > 60_000)) {
        const snap = snapshotState();
        window.termcanvas.state.save(JSON.parse(snap));
        useWorkspaceStore.getState().markClean();
        updateWindowTitle();
      }
    }, 60_000);

    return () => {
      unsubscribe();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (backstopTimer) clearInterval(backstopTimer);
    };
  }, []);
}
```

**Step 4: Refactor useCloseHandler**

Replace the existing `useCloseHandler` function (lines 168-212) with:

```ts
function useCloseHandler() {
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  useEffect(() => {
    if (!window.termcanvas) return;

    const unsubscribe = window.termcanvas.app.onBeforeClose(() => {
      const { dirty } = useWorkspaceStore.getState();
      if (!dirty) {
        // Clean state — save recovery snapshot and close directly
        const snap = snapshotState();
        window.termcanvas.state.save(JSON.parse(snap));
        window.termcanvas.app.confirmClose();
        return;
      }
      setShowCloseDialog(true);
    });

    return unsubscribe;
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const snap = snapshotState();
      const { workspacePath } = useWorkspaceStore.getState();

      if (workspacePath) {
        await window.termcanvas.workspace.saveToPath(workspacePath, snap);
      } else {
        const saved = await window.termcanvas.workspace.save(snap);
        if (!saved) {
          // User cancelled file picker — stay open
          setShowCloseDialog(false);
          return;
        }
      }
      // Also save to auto-restore
      window.termcanvas.state.save(JSON.parse(snap));
      window.termcanvas.app.confirmClose();
    } catch (err) {
      console.error("[CloseHandler] save failed:", err);
      const { notify } = useNotificationStore.getState();
      notify("error", `Save failed: ${err}`);
      setShowCloseDialog(false);
    }
  }, []);

  const handleDiscard = useCallback(() => {
    // Set skipRestore flag — preserves autosaved data but prevents restore on next launch
    window.termcanvas.state.save({ skipRestore: true });
    window.termcanvas.app.confirmClose();
  }, []);

  const handleCancel = useCallback(() => {
    setShowCloseDialog(false);
  }, []);

  return { showCloseDialog, handleSave, handleDiscard, handleCancel };
}
```

**Step 5: Update useStatePersistence to check skipRestore**

Replace the existing `useStatePersistence` (lines 139-148):

```ts
function useStatePersistence() {
  useEffect(() => {
    if (!window.termcanvas) return;
    window.termcanvas.state.load().then((saved) => {
      if (!saved) return;
      const data = saved as Record<string, unknown>;
      if (data.skipRestore) {
        // Clear the flag for next time, but don't restore
        window.termcanvas.state.save({ skipRestore: false });
        return;
      }
      restoreFromData(data);
    }).catch((err) => {
      console.error("[useStatePersistence] failed to load state:", err);
    });
  }, []);
}
```

**Step 6: Add dirty gate to useWorkspaceOpen**

Replace the existing `useWorkspaceOpen` (lines 151-165):

```ts
function useWorkspaceOpen() {
  useEffect(() => {
    const handler = (e: Event) => {
      const { dirty } = useWorkspaceStore.getState();
      if (dirty) {
        // TODO: for now, just warn. A proper modal gate can be added later.
        if (!confirm("Unsaved changes will be lost. Continue?")) return;
      }
      const raw = (e as CustomEvent<string>).detail;
      try {
        restoreFromData(JSON.parse(raw));
        useWorkspaceStore.getState().markClean();
      } catch (err) {
        console.error("[useWorkspaceOpen] failed to parse workspace file:", err);
      }
    };
    window.addEventListener("termcanvas:open-workspace", handler);
    return () =>
      window.removeEventListener("termcanvas:open-workspace", handler);
  }, []);
}
```

**Step 7: Wire hooks in App component**

In the `App` component body (~line 259), add the new hooks:

```ts
  useAutoSave();
```

Add necessary imports at the top of App.tsx:

```ts
import { useWorkspaceStore } from "./stores/workspaceStore";
import { snapshotState } from "./snapshotState";
import { updateWindowTitle } from "./titleHelper";
import { useNotificationStore } from "./stores/notificationStore";
```

Remove the old local imports that are no longer needed (serializeAllTerminals — now in snapshotState.ts).

**Step 8: Update title on dirty/clean changes**

Add a `useEffect` in `App` that subscribes to workspace store and updates the title:

```ts
  useEffect(() => {
    const unsub = useWorkspaceStore.subscribe(() => updateWindowTitle());
    updateWindowTitle(); // initial
    return unsub;
  }, []);
```

**Step 9: Run full test suite**

Run: `npm test`
Expected: all PASS

**Step 10: Commit**

```
git add src/snapshotState.ts src/titleHelper.ts src/App.tsx
git commit -m "feat: auto-save, close flow refactor, dirty-aware title"
```

---

### Task 7: Update workspace:save IPC to return the file path

Currently `workspace:save` returns `boolean`. To support setting `workspacePath` after a Save-As, it should return the saved file path (or `null` if cancelled).

**Files:**
- Modify: `electron/main.ts:448-457`
- Modify: `electron/preload.ts:100-101`

**Step 1: Update main.ts handler**

In `electron/main.ts:448-457`, change:

```ts
  ipcMain.handle("workspace:save", async (_event, data: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save Workspace",
      defaultPath: "workspace.termcanvas",
      filters: [{ name: "TermCanvas Workspace", extensions: ["termcanvas"] }],
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, data, "utf-8");
    return true;
  });
```

to:

```ts
  ipcMain.handle("workspace:save", async (_event, data: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save Workspace",
      defaultPath: "workspace.termcanvas",
      filters: [{ name: "TermCanvas Workspace", extensions: ["termcanvas"] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, data, "utf-8");
    return result.filePath;
  });
```

**Step 2: Update preload return type**

In `electron/preload.ts:100-101`, change:

```ts
    save: (data: string) =>
      ipcRenderer.invoke("workspace:save", data) as Promise<boolean>,
```

to:

```ts
    save: (data: string) =>
      ipcRenderer.invoke("workspace:save", data) as Promise<string | null>,
```

**Step 3: Update all callers to use the new return type**

In the save handlers (useCloseHandler's `handleSave`, keyboard shortcut handlers), update from:

```ts
const saved = await window.termcanvas.workspace.save(snap);
if (saved) { ... }
```

to:

```ts
const savedPath = await window.termcanvas.workspace.save(snap);
if (savedPath) {
  useWorkspaceStore.getState().setWorkspacePath(savedPath);
  ...
}
```

Apply this to:
- `src/App.tsx` — `handleSave` in `useCloseHandler`
- `src/hooks/useKeyboardShortcuts.ts` — save and saveAs handlers

**Step 4: Run full test suite**

Run: `npm test`
Expected: all PASS

**Step 5: Commit**

```
git add electron/main.ts electron/preload.ts src/App.tsx src/hooks/useKeyboardShortcuts.ts
git commit -m "feat: workspace:save returns file path for workspacePath tracking"
```

---

### Task 8: Final integration and shortcut hints

**Files:**
- Modify: `src/i18n/en.ts` — shortcut hint entries
- Modify: `src/i18n/zh.ts` — shortcut hint entries
- Modify: `src/components/ShortcutHints.tsx` (if it exists, to show new shortcuts)

**Step 1: Verify shortcut hints display**

Check if `ShortcutHints.tsx` iterates over all shortcut keys. If it does, the new `saveWorkspace` / `saveWorkspaceAs` entries will appear automatically via the i18n keys added in Task 5.

**Step 2: Manual smoke test**

Test the following scenarios manually:
1. Launch app → make a change → title shows `* Untitled — TermCanvas`
2. Cmd+S → file picker opens (first save) → save → title shows `filename — TermCanvas`
3. Make another change → title shows `* filename — TermCanvas`
4. Cmd+S → silent save (no dialog) → title shows `filename — TermCanvas`
5. Cmd+Shift+S → file picker (different name) → save → workspacePath updated
6. Wait 5s after change → state.json updated (check `~/.termcanvas/state.json` mtime)
7. Close with unsaved changes → dialog appears
8. Close with no changes → closes directly
9. "Don't Save" → sets skipRestore flag → restart → empty canvas
10. Open workspace when dirty → confirmation prompt

**Step 3: Run full test suite**

Run: `npm test`
Expected: all PASS

**Step 4: Final commit**

```
git add -A
git commit -m "feat: complete save mechanism refactor — Save/SaveAs/autosave/graceful shutdown"
```
