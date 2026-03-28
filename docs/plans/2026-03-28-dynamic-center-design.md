# Dynamic Clamp Centering for Focused Terminals

## Problem

`panToTerminal` and `panToWorktree` calculate the center position using only the
right panel offset, ignoring the left panel width. When the left panel is open,
the focused terminal appears too far to the right because the centering anchor is
`(window.innerWidth - rightOffset) / 2` instead of the true visual center.

## Design

### Goal

1. Terminal stays centered relative to the **full screen width** in most cases.
2. When the terminal would be occluded by the left panel, shift right just enough
   to keep it fully visible with a safe padding.
3. Same treatment for the right panel edge.

### Algorithm

```
SAFE_PADDING = 40

// Step 1 — ideal center (full-screen midpoint)
idealCenterX = -(objectCenterWorldX) * scale + window.innerWidth / 2

// Step 2 — left clamp
screenLeftEdge = idealCenterX + objectWorldX * scale
safeLeft = leftOffset + SAFE_PADDING
if (screenLeftEdge < safeLeft):
    centerX = idealCenterX + (safeLeft - screenLeftEdge)
else:
    centerX = idealCenterX

// Step 3 — right clamp
screenRightEdge = centerX + (objectWorldX + objectW) * scale
safeRight = window.innerWidth - rightOffset - SAFE_PADDING
if (screenRightEdge > safeRight):
    centerX -= (screenRightEdge - safeRight)
```

Y-axis centering and scale calculation remain unchanged.

### Affected Files

- `src/utils/panToTerminal.ts` — two centerX calculations (published geometry path
  and fallback layout path)
- `src/utils/panToWorktree.ts` — one centerX calculation
- `src/canvas/viewportBounds.ts` — add `getCanvasLeftInset` helper

### Constants

- `SAFE_PADDING = 40` — minimum distance between the object edge and any panel

### Unchanged

- Y-axis centering logic
- Scale / zoom calculation
- Left panel still pushes the canvas (no overlay change)
