# File Tree Drag & Drop Design

## Overview

Add two drag-and-drop capabilities to the left panel file tree:

1. **File tree → Terminal**: Drag a file/folder from the file tree onto any visible terminal tile to insert its absolute path at the cursor position.
2. **OS → File tree**: Drag files/folders from the OS file manager (Finder) into the file tree to copy them into the project.

Both features use HTML5 native drag-drop (`dataTransfer` API).

## Feature 1: File Tree → Terminal (Insert Path)

### Drag Source (FilesContent.tsx)

- Every file/folder node gets `draggable={true}`.
- `onDragStart`: write the full path into `dataTransfer`:
  - `setData("text/plain", fullPath)` — consumed by the terminal on drop.
  - `setData("application/x-termcanvas-file", fullPath)` — custom MIME type to distinguish internal drags from OS drags in the file tree.
  - `effectAllowed = "copy"`.

### Drop Target (TerminalTile.tsx)

- Add `onDragOver`: call `e.preventDefault()`, set `dropEffect = "copy"`, set highlight state.
- Add `onDragLeave`: clear highlight state.
- Add `onDrop`:
  1. Read path from `e.dataTransfer.getData("text/plain")`.
  2. Shell-escape the path (backslash-escape spaces, quotes, parentheses, and other shell metacharacters).
  3. Write the escaped path to the PTY via `window.termcanvas.terminal.input(ptyId, escapedPath)`.
  4. Look up `ptyId` from the managed runtime in `terminalRuntimeStore`.

### Visual Feedback

- When dragging over a terminal tile: accent-colored border glow (similar to focus shadow).
- On drag leave / drop: revert to normal.

### Shell Escape

Escape these characters with backslash: ` `, `'`, `"`, `(`, `)`, `[`, `]`, `{`, `}`, `$`, `!`, `&`, `|`, `;`, `<`, `>`, `` ` ``, `#`, `~`, `*`, `?`, `\`.

Example: `my file (1).ts` → `my\ file\ \(1\).ts`

## Feature 2: OS → File Tree (Copy Files)

### New IPC: `fs:copy`

- **Main process** (`electron/main.ts`): register `fs:copy` handler.
  - Input: `{ sources: string[], destDir: string }`
  - Uses Node.js `fs.cp(src, dest, { recursive: true })` for each source.
  - Returns `{ copied: string[], skipped: string[] }`.
  - If a file/folder already exists at the destination, skip it and include in `skipped`.
- **Preload** (`electron/preload.ts`): expose `window.termcanvas.fs.copy(sources, destDir)`.

### Drop Target (FilesContent.tsx)

- Distinguish OS drag from internal drag by checking `e.dataTransfer.types`:
  - Contains `"Files"` but not `"application/x-termcanvas-file"` → OS drag.
  - Contains `"application/x-termcanvas-file"` → internal drag (ignore in file tree).
- Directory nodes listen for `onDragOver` / `onDrop`:
  - Drop on a directory → copy into that directory.
- File tree container listens as fallback:
  - Drop on empty area → copy into project root (`worktreePath`).
- After copy completes:
  - Refresh the affected directory in `useWorktreeFiles` (re-call `listDir`).
  - If any files were skipped, show a notification listing them.

### Visual Feedback

- Dragging over a directory node: accent background highlight.
- Dragging over empty area: accent border on the file tree container.
- On drag leave / drop: revert.

## Distinguishing Drag Sources

| Scenario | `dataTransfer.types` | Action |
|---|---|---|
| File tree node dragged | `text/plain`, `application/x-termcanvas-file` | Terminal: insert path. File tree: ignore. |
| OS file dragged | `Files` | File tree: copy files. Terminal: could also insert path via `file.path`. |

## Affected Files

| File | Changes |
|---|---|
| `src/components/LeftPanel/FilesContent.tsx` | Add `draggable`, `onDragStart`, `onDragOver`, `onDrop`, highlight states |
| `src/terminal/TerminalTile.tsx` | Add `onDragOver`, `onDragLeave`, `onDrop`, highlight state |
| `src/terminal/terminalRuntimeStore.ts` | Expose helper to get `ptyId` by terminal ID |
| `electron/main.ts` | Register `fs:copy` IPC handler |
| `electron/preload.ts` | Expose `fs.copy` in preload bridge |
| `src/types/index.ts` | Update `termcanvas` global type for `fs.copy` |
| `src/hooks/useWorktreeFiles.ts` | Add `refreshDir` method to reload a directory |
