# Dynamic Terminal Tile Aspect Ratio

## Problem

`TERMINAL_W` (640) and `TERMINAL_H` (480) are fixed constants. When the left panel is open and the available viewport becomes narrower and taller, the focused terminal tile — still at 4:3 — wastes significant screen space. The zoom scale shrinks the tile to fit the narrower viewport, making everything smaller rather than adapting to the new shape.

## Solution

Make `TERMINAL_W` and `TERMINAL_H` dynamic values derived from the viewport's available aspect ratio. When the viewport becomes narrower, tiles become narrower and taller. When it becomes wider, tiles become wider and shorter. The total tile area stays roughly constant (~307200px²).

## Calculation

```
availableW = windowWidth - leftOffset - rightOffset
availableH = windowHeight
viewportRatio = availableW / availableH

area = 640 * 480  // 307200, preserved as constant
TERMINAL_H = sqrt(area / viewportRatio)
TERMINAL_W = area / TERMINAL_H
```

Clamp both values to reasonable min/max to prevent extreme aspect ratios (e.g., W min 400, max 900; H min 300, max 700).

## Responsive Triggers

Recalculate when:
- Window resizes
- Left panel opens / closes / drag-resizes
- Right panel opens / closes

Store the dynamic values in a reactive store (or derive in a hook) so all consumers re-render.

## Transition Animation

When tile dimensions change:
- Tile `width`, `height`, `left`, `top` animate via CSS transition (~200ms ease)
- Worktree container size also transitions smoothly
- xterm refit fires once after the transition ends (on `transitionend`), not during animation, to avoid rapid PTY resize churn

## Affected Code

- `layout.ts` — `TERMINAL_W`/`TERMINAL_H` become dynamic (function or store-derived)
- `packTerminals()` — accepts dynamic W/H as parameters
- `computeWorktreeSize()` / `getWorktreeSize()` / `getStandardWorktreeWidth()` — same
- `xyflowNodes.tsx` — passes dynamic dimensions through
- `TerminalTile.tsx` — add `width`/`height` to CSS transition; debounce xterm fit to `transitionend`
- `panToTerminal.ts` — no change needed (already reads tile geometry dynamically)
- `XyFlowCanvas.tsx` — geometry publishing already reads current sizes

## What Does NOT Change

- Span system (1×1, 2×1, 1×2, 2×2)
- Bin-packing algorithm logic
- Canvas zoom / pan mechanics
- Terminal runtime / PTY lifecycle
