# Bug: Terminal close and minimize buttons not working

**Date:** 2026-03-16
**Status:** Open — root cause not yet confirmed
**Affected version:** Current main (after commit `de94b42`)

## Symptom

- Individual terminal **close (X) button** can be clicked but the terminal is not removed.
- Individual terminal **minimize (−) button** can be clicked but the terminal does not collapse.
- The issue affects terminals in the **upper area**; terminals lower on the screen can be closed normally.
- Buttons are visually responsive (hover states work, clicks register), but the expected state change does not occur.

## Reproduction

1. Open a project with multiple terminals in a worktree.
2. Click the close (X) or minimize (−) button on a terminal positioned near the top.
3. Observe: nothing happens. The terminal remains open and un-minimized.
4. Click the same buttons on a terminal positioned lower — it works as expected.

## Investigation

### Code path traced

**Close button** (`src/terminal/TerminalTile.tsx:573-578`):
```
onClick → handleClose()
  → cleanupRef.current?.()   // dispose xterm, destroy PTY, remove listeners
  → removeTerminal(projectId, worktreeId, terminal.id)
    → projectStore.set() filters out the terminal by ID
```

**Minimize button** (`src/terminal/TerminalTile.tsx:547-550`):
```
onClick → toggleTerminalMinimize(projectId, worktreeId, terminal.id)
  → projectStore.set() toggles terminal.minimized via mapTerminals()
```

### Potential causes (not yet confirmed)

#### 1. `cleanupRef.current()` throwing — blocks `removeTerminal` (close only)

`handleClose` calls cleanup **before** `removeTerminal` with no try/catch:

```ts
const handleClose = useCallback(() => {
    cleanupRef.current?.();     // if this throws...
    cleanupRef.current = null;  // ...these lines
    removeTerminal(...);        // ...never execute
}, [...]);
```

The cleanup function (`TerminalTile.tsx:399-421`) calls `xterm.dispose()` which now includes the **WebGL addon** (added in commit `de94b42`). If the WebGL context is lost or in a bad state, `dispose()` could throw, silently preventing terminal removal.

However, this does **not** explain why minimize also fails (minimize does not call cleanup).

#### 2. Drag system interfering with click

The title bar has `onMouseDown` that triggers terminal drag (`handleTerminalDragStart` in `WorktreeContainer.tsx:160`). This calls `e.preventDefault()`, `e.stopPropagation()`, and `setDragState()` which triggers a re-render with `transform: scale(1.02)` on the tile. On mouseup, drag state is cleared, triggering another re-render.

The button's `onClick` fires after these re-renders. While React should preserve the DOM element across reconciliation, the rapid state changes between mousedown → mouseup → click could theoretically interfere with the click handler execution in edge cases.

#### 3. Position-dependent visual illusion (close only)

When an upper terminal is deleted, `packTerminals()` re-packs the remaining terminals. The terminal below shifts up to fill the vacated position. The user may perceive that the original terminal is still there because a different terminal now occupies the same visual position.

This would **not** explain minimize failing, since minimizing does not trigger re-packing.

#### 4. Runtime error in store update

If `resolveOverlaps()` (called by `removeTerminal`) throws for certain terminal configurations, the entire Zustand `set()` call would fail silently, leaving the state unchanged.

### Ruled out

- **Event interception by overlays**: BoxSelectOverlay, CompletionGlow, ShortcutHints all have `pointer-events: none`. DrawingLayer only blocks events in drawing mode.
- **Toolbar/Sidebar covering buttons**: Toolbar is `z-50 h-11` (44px top strip). Sidebar is `z-40` at left edge. Neither covers the terminal button area in normal usage.
- **`syncWorktrees` overwriting changes**: The sync uses `set((state) => ...)` which reads latest state, and preserves existing terminal data by matching worktrees by path.
- **Zustand race conditions**: All store updates use the updater pattern `set((state) => ...)` and Zustand processes `set` calls synchronously.
- **Missing `TYPE_CONFIG` for lazygit**: `TYPE_CONFIG` in `TerminalTile.tsx` lacks a `"lazygit"` entry (would crash rendering for lazygit terminals), but this is a separate issue that only affects lazygit terminal tiles.

## Next steps

- [ ] Check browser DevTools console for errors when clicking close/minimize on affected terminals
- [ ] Add try/catch around `cleanupRef.current?.()` in `handleClose` so `removeTerminal` always executes
- [ ] Add `"lazygit"` to `TYPE_CONFIG` to prevent render crash for lazygit terminals
- [ ] Add `onMouseDown={(e) => e.stopPropagation()}` to close/minimize buttons to prevent drag system activation on button clicks
