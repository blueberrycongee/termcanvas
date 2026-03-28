# File Tree Drag & Drop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable dragging files from the file tree to terminals (inserts shell-escaped path) and from OS into the file tree (copies files into the project).

**Architecture:** HTML5 native drag-drop throughout. Internal drags are tagged with a custom MIME type (`application/x-termcanvas-file`) so file tree drop handlers can distinguish them from OS drops. Terminal drop targets read `text/plain` from `dataTransfer` and write the escaped path to the PTY via the existing `terminal:input` IPC. OS file drops trigger a new `fs:copy` IPC that uses Node.js `fs.cp`.

**Tech Stack:** React, Electron IPC, HTML5 Drag and Drop API, Node.js `fs.cp`, xterm.js PTY input

---

### Task 1: Shell escape utility + tests

**Files:**
- Create: `src/utils/shellEscape.ts`
- Create: `tests/shell-escape.test.ts`

**Step 1: Write the failing test**

```ts
// tests/shell-escape.test.ts
import test from "node:test";
import assert from "node:assert/strict";

test("shellEscapePath escapes spaces", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(shellEscapePath("/path/to/my file.ts"), "/path/to/my\\ file.ts");
});

test("shellEscapePath escapes parentheses", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(shellEscapePath("/path/to/file (1).ts"), "/path/to/file\\ \\(1\\).ts");
});

test("shellEscapePath escapes multiple special characters", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(
    shellEscapePath("/tmp/it's a $HOME/test&file"),
    "/tmp/it\\'s\\ a\\ \\$HOME/test\\&file",
  );
});

test("shellEscapePath returns plain path unchanged", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(shellEscapePath("/Users/foo/bar.ts"), "/Users/foo/bar.ts");
});

test("shellEscapePath escapes backslashes", async () => {
  const { shellEscapePath } = await import("../src/utils/shellEscape.ts");
  assert.equal(shellEscapePath("/path/with\\backslash"), "/path/with\\\\backslash");
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/shell-escape.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```ts
// src/utils/shellEscape.ts
const SHELL_META = /[ '"()[\]{}$!&|;<>`#~*?\\]/g;

export function shellEscapePath(p: string): string {
  return p.replace(SHELL_META, (ch) => `\\${ch}`);
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/shell-escape.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/utils/shellEscape.ts tests/shell-escape.test.ts
git commit -m "feat: add shell escape utility for file path insertion"
```

---

### Task 2: Expose `getPtyId` helper from terminal runtime store

**Files:**
- Modify: `src/terminal/terminalRuntimeStore.ts` (after line ~1196, the last export)

**Step 1: Write the implementation**

Add this exported function at the end of the file (after `destroyAllTerminalRuntimes`):

```ts
export function getTerminalPtyId(terminalId: string): number | null {
  const runtime = runtimeRegistry.get(terminalId);
  return runtime?.ptyId ?? null;
}
```

`runtimeRegistry` is the module-level `Map<string, ManagedTerminalRuntime>` at line 105.

**Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add src/terminal/terminalRuntimeStore.ts
git commit -m "feat: expose getTerminalPtyId helper for drag-drop"
```

---

### Task 3: Add `refreshDir` to `useWorktreeFiles` hook

**Files:**
- Modify: `src/hooks/useWorktreeFiles.ts`

**Step 1: Add `refreshDir` callback**

Add after the `toggleDir` callback (after line 44), before the return:

```ts
const refreshDir = useCallback(
  (dirPath: string) => {
    window.termcanvas.fs.listDir(dirPath).then((items) => {
      setEntries((prev) => new Map(prev).set(dirPath, items));
    });
  },
  [],
);
```

**Step 2: Include in return value**

Change the return at line 47 from:

```ts
return { entries, expandedDirs, toggleDir, loading };
```

to:

```ts
return { entries, expandedDirs, toggleDir, refreshDir, loading };
```

**Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 4: Commit**

```bash
git add src/hooks/useWorktreeFiles.ts
git commit -m "feat: add refreshDir to useWorktreeFiles for post-copy reload"
```

---

### Task 4: Make file tree nodes draggable (drag source)

**Files:**
- Modify: `src/components/LeftPanel/FilesContent.tsx`

**Step 1: Add `onDragStart` handler to file/folder button**

In the `renderEntries` function, find the `<button>` element at line 57. Add `draggable` and `onDragStart`:

Change line 57's `<button` opening to:

```tsx
<button
  draggable
  onDragStart={(e) => {
    e.dataTransfer.setData("text/plain", fullPath);
    e.dataTransfer.setData("application/x-termcanvas-file", fullPath);
    e.dataTransfer.effectAllowed = "copy";
  }}
  className={`w-full flex items-center gap-1.5 py-1 transition-colors duration-150 text-left ${
```

Everything else in the button stays the same.

**Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 3: Verify in app**

Run the app. In the file tree, drag a file — cursor should show a copy drag icon. Dropping anywhere outside a terminal should do nothing.

**Step 4: Commit**

```bash
git add src/components/LeftPanel/FilesContent.tsx
git commit -m "feat: make file tree nodes draggable with path data"
```

---

### Task 5: Terminal tile drop target (insert path into PTY)

**Files:**
- Modify: `src/terminal/TerminalTile.tsx`

**Step 1: Add drag-over highlight state**

Inside the `TerminalTile` component (after line 215, near other useState calls), add:

```ts
const [dragOver, setDragOver] = useState(false);
```

**Step 2: Add drag event handlers**

Add these imports at the top of the file:

```ts
import { shellEscapePath } from "../utils/shellEscape";
import { getTerminalPtyId } from "./terminalRuntimeStore";
```

Then add these handler functions inside the component, after the `handleClose` callback (~line 462):

```ts
const handleTileDragOver = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = "copy";
  setDragOver(true);
}, []);

const handleTileDragLeave = useCallback((e: React.DragEvent) => {
  e.stopPropagation();
  setDragOver(false);
}, []);

const handleTileDrop = useCallback(
  (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const filePath = e.dataTransfer.getData("text/plain");
    if (!filePath) return;

    const ptyId = getTerminalPtyId(terminal.id);
    if (ptyId === null) return;

    const escaped = shellEscapePath(filePath);
    window.termcanvas.terminal.input(ptyId, escaped);
  },
  [terminal.id],
);
```

**Step 3: Wire handlers + visual feedback onto the tile div**

On the root `<div ref={tileRef} ...>` at line 464, add the three handlers and modify the `boxShadow` style to include drag-over feedback:

Add to the div's props:

```tsx
onDragOver={handleTileDragOver}
onDragLeave={handleTileDragLeave}
onDrop={handleTileDrop}
```

Update the `boxShadow` in the style object (line 477-480) from:

```ts
boxShadow: isDragging
  ? "0 8px 32px rgba(0,0,0,0.3)"
  : terminal.focused
    ? "0 0 0 1px rgba(0,112,243,0.45), 0 0 8px rgba(0,112,243,0.15)"
    : undefined,
```

to:

```ts
boxShadow: isDragging
  ? "0 8px 32px rgba(0,0,0,0.3)"
  : dragOver
    ? "0 0 0 2px var(--accent), 0 0 12px rgba(80,227,194,0.25)"
    : terminal.focused
      ? "0 0 0 1px rgba(0,112,243,0.45), 0 0 8px rgba(0,112,243,0.15)"
      : undefined,
```

**Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 5: Manual test**

Run the app. Drag a file from the file tree over a terminal — accent glow should appear. Drop it — the escaped path should appear in the terminal input.

**Step 6: Commit**

```bash
git add src/terminal/TerminalTile.tsx
git commit -m "feat: terminal tile accepts file drop and inserts escaped path"
```

---

### Task 6: `fs:copy` IPC handler + test

**Files:**
- Modify: `electron/main.ts` (add handler near `fs:list-dir` at line ~608)
- Modify: `electron/preload.ts` (add to `fs` object at line ~198)
- Modify: `src/types/index.ts` (add to `TermCanvasAPI.fs` at line ~416)
- Create: `tests/fs-copy.test.ts`

**Step 1: Write the failing test**

```ts
// tests/fs-copy.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fs-copy-test-"));
}

test("copyFiles copies a single file to destDir", async () => {
  const { copyFiles } = await import("../electron/fs-copy.ts");
  const src = makeTmpDir();
  const dest = makeTmpDir();
  fs.writeFileSync(path.join(src, "a.txt"), "hello");

  const result = await copyFiles([path.join(src, "a.txt")], dest);
  assert.deepEqual(result.copied, ["a.txt"]);
  assert.deepEqual(result.skipped, []);
  assert.equal(fs.readFileSync(path.join(dest, "a.txt"), "utf8"), "hello");

  fs.rmSync(src, { recursive: true });
  fs.rmSync(dest, { recursive: true });
});

test("copyFiles copies a directory recursively", async () => {
  const { copyFiles } = await import("../electron/fs-copy.ts");
  const src = makeTmpDir();
  const dest = makeTmpDir();
  const sub = path.join(src, "sub");
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, "b.txt"), "world");

  const result = await copyFiles([sub], dest);
  assert.deepEqual(result.copied, ["sub"]);
  assert.equal(fs.readFileSync(path.join(dest, "sub", "b.txt"), "utf8"), "world");

  fs.rmSync(src, { recursive: true });
  fs.rmSync(dest, { recursive: true });
});

test("copyFiles skips existing names", async () => {
  const { copyFiles } = await import("../electron/fs-copy.ts");
  const src = makeTmpDir();
  const dest = makeTmpDir();
  fs.writeFileSync(path.join(src, "c.txt"), "new");
  fs.writeFileSync(path.join(dest, "c.txt"), "old");

  const result = await copyFiles([path.join(src, "c.txt")], dest);
  assert.deepEqual(result.copied, []);
  assert.deepEqual(result.skipped, ["c.txt"]);
  assert.equal(fs.readFileSync(path.join(dest, "c.txt"), "utf8"), "old");

  fs.rmSync(src, { recursive: true });
  fs.rmSync(dest, { recursive: true });
});

test("copyFiles handles multiple files", async () => {
  const { copyFiles } = await import("../electron/fs-copy.ts");
  const src = makeTmpDir();
  const dest = makeTmpDir();
  fs.writeFileSync(path.join(src, "x.txt"), "x");
  fs.writeFileSync(path.join(src, "y.txt"), "y");

  const result = await copyFiles([
    path.join(src, "x.txt"),
    path.join(src, "y.txt"),
  ], dest);
  assert.deepEqual(result.copied.sort(), ["x.txt", "y.txt"]);
  assert.deepEqual(result.skipped, []);

  fs.rmSync(src, { recursive: true });
  fs.rmSync(dest, { recursive: true });
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/fs-copy.test.ts`
Expected: FAIL — module not found

**Step 3: Write the `copyFiles` module**

```ts
// electron/fs-copy.ts
import fs from "node:fs";
import path from "node:path";

export async function copyFiles(
  sources: string[],
  destDir: string,
): Promise<{ copied: string[]; skipped: string[] }> {
  const copied: string[] = [];
  const skipped: string[] = [];

  for (const src of sources) {
    const name = path.basename(src);
    const dest = path.join(destDir, name);

    if (fs.existsSync(dest)) {
      skipped.push(name);
      continue;
    }

    await fs.promises.cp(src, dest, { recursive: true });
    copied.push(name);
  }

  return { copied, skipped };
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/fs-copy.test.ts`
Expected: All 4 tests PASS

**Step 5: Register IPC handler in `electron/main.ts`**

Find the `fs:list-dir` handler (line ~608). After the `fs:read-file` handler's closing `});` (line ~622 area), add:

```ts
ipcMain.handle(
  "fs:copy",
  async (_event, sources: string[], destDir: string) => {
    const { copyFiles } = await import("./fs-copy.js");
    return copyFiles(sources, destDir);
  },
);
```

**Step 6: Add to preload**

In `electron/preload.ts`, inside the `fs: {` object (line ~198), after the `readFile` method, add:

```ts
copy: (sources: string[], destDir: string) =>
  ipcRenderer.invoke("fs:copy", sources, destDir) as Promise<
    { copied: string[]; skipped: string[] }
  >,
```

**Step 7: Add to type definition**

In `src/types/index.ts`, inside the `fs:` block (after line 421 `};`), add before the closing `};`:

```ts
copy: (sources: string[], destDir: string) => Promise<{
  copied: string[];
  skipped: string[];
}>;
```

**Step 8: Verify types**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 9: Commit**

```bash
git add electron/fs-copy.ts tests/fs-copy.test.ts electron/main.ts electron/preload.ts src/types/index.ts
git commit -m "feat: add fs:copy IPC for OS file drop into project"
```

---

### Task 7: File tree drop target for OS files

**Files:**
- Modify: `src/components/LeftPanel/FilesContent.tsx`
- Modify: `src/hooks/useWorktreeFiles.ts` (already done in Task 3)

**Step 1: Add drop state and imports**

At the top of `FilesContent.tsx`, add:

```ts
import { useNotificationStore } from "../../stores/notificationStore";
```

Inside `FilesContent`, add state for tracking the drag-over target directory:

```ts
const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
```

And get `refreshDir` from the hook — update line 34 from:

```ts
const { entries, expandedDirs, toggleDir, loading } = useWorktreeFiles(worktreePath);
```

to:

```ts
const { entries, expandedDirs, toggleDir, refreshDir, loading } = useWorktreeFiles(worktreePath);
```

**Step 2: Add helper to detect OS drag**

Add inside the component:

```ts
const isOsDrag = (e: React.DragEvent) =>
  e.dataTransfer.types.includes("Files") &&
  !e.dataTransfer.types.includes("application/x-termcanvas-file");
```

**Step 3: Add drop handlers for directory nodes**

Add inside the component:

```ts
const handleDirDragOver = useCallback(
  (e: React.DragEvent, dirPath: string) => {
    if (!isOsDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDropTargetDir(dirPath);
  },
  [],
);

const handleDirDragLeave = useCallback((e: React.DragEvent) => {
  e.stopPropagation();
  setDropTargetDir(null);
}, []);

const handleDirDrop = useCallback(
  async (e: React.DragEvent, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetDir(null);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // @ts-ignore - path property exists on File in Electron
    const sources: string[] = files.map((f) => f.path).filter(Boolean);
    if (sources.length === 0) return;

    const result = await window.termcanvas.fs.copy(sources, dirPath);
    refreshDir(dirPath);

    if (result.skipped.length > 0) {
      const { notify } = useNotificationStore.getState();
      notify("warning", `Skipped (already exist): ${result.skipped.join(", ")}`);
    }
  },
  [refreshDir],
);
```

**Step 4: Wire handlers onto directory nodes**

In `renderEntries`, on the `<button>` element (the one with `draggable`), add drag-over handlers for directory entries. Wrap the existing button with additional props when `entry.isDirectory`:

After the `onDragStart` handler, add conditionally:

```tsx
onDragOver={entry.isDirectory ? (e) => handleDirDragOver(e, fullPath) : undefined}
onDragLeave={entry.isDirectory ? handleDirDragLeave : undefined}
onDrop={entry.isDirectory ? (e) => handleDirDrop(e, fullPath) : undefined}
```

Add visual feedback — modify the className of the button to include drag-over highlight. Change the className expression to add a `dropTargetDir === fullPath` case:

```tsx
className={`w-full flex items-center gap-1.5 py-1 transition-colors duration-150 text-left ${
  dropTargetDir === fullPath
    ? "bg-[rgba(80,227,194,0.15)] border-l-2 border-[var(--accent)]"
    : isSelected
      ? "bg-[var(--surface-hover)] border-l-2 border-[var(--accent)]"
      : "hover:bg-[var(--surface-hover)] border-l-2 border-transparent"
}`}
```

**Step 5: Wire handlers onto the file tree container (fallback for root drop)**

On the outermost `<div>` in the main return (line 124), add:

```tsx
<div
  className={`flex-1 overflow-auto min-h-0 pt-1 ${dropTargetDir === worktreePath ? "ring-1 ring-[var(--accent)]" : ""}`}
  style={{ ...MONO_STYLE, fontSize: 11 }}
  onDragOver={(e) => {
    if (!isOsDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dropTargetDir) setDropTargetDir(worktreePath);
  }}
  onDragLeave={(e) => {
    if (e.currentTarget === e.target) setDropTargetDir(null);
  }}
  onDrop={(e) => handleDirDrop(e, worktreePath!)}
>
```

**Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 7: Manual test**

Run the app. Drag a file from Finder into:
- A directory in the file tree → file copies there, tree refreshes
- Empty area in the file tree → file copies to project root, tree refreshes
- Drag an existing file → notification shows "Skipped"

**Step 8: Commit**

```bash
git add src/components/LeftPanel/FilesContent.tsx
git commit -m "feat: file tree accepts OS file drops and copies into project"
```

---

### Task 8: Type-check and final verification

**Files:** None (verification only)

**Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 2: Run all tests**

Run: `npx tsx --test tests/shell-escape.test.ts tests/fs-copy.test.ts`
Expected: All tests pass

**Step 3: Manual E2E verification**

1. Drag file from tree → terminal: escaped path appears in terminal
2. Drag file from tree → different terminal: path appears in that terminal
3. Drag directory from tree → terminal: directory path appears
4. Drag file from Finder → directory in tree: file copied, tree refreshed
5. Drag file from Finder → empty area in tree: file copied to root
6. Drag multiple files from Finder → directory: all copied
7. Drag file that already exists → notification shows skipped
