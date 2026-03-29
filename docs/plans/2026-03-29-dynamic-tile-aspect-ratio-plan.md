# Dynamic Terminal Tile Aspect Ratio — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make terminal tile base dimensions (W/H) respond to the viewport aspect ratio so tiles better fill available screen space when panels open/close.

**Architecture:** Extract `TERMINAL_W`/`TERMINAL_H` from fixed constants into a reactive Zustand store (`tileDimensionsStore`) that recomputes on window resize and panel state changes. All layout functions (`packTerminals`, `getWorktreeSize`, etc.) accept W/H as parameters. CSS transitions on tile position/size provide smooth animation; xterm refit is debounced to `transitionend`.

**Tech Stack:** TypeScript, Zustand, React hooks, CSS transitions, node:test

---

### Task 1: Create `tileDimensionsStore` with dynamic W/H calculation

**Files:**
- Create: `src/stores/tileDimensionsStore.ts`
- Test: `tests/tile-dimensions-store.test.ts`

**Step 1: Write the failing test**

Create `tests/tile-dimensions-store.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

import { computeTileDimensions } from "../src/stores/tileDimensionsStore.ts";

test("computeTileDimensions returns default 640x480 for default viewport", () => {
  // Default: windowWidth=1920, leftOffset=32, rightOffset=32
  // availableW = 1920 - 32 - 32 = 1856
  // availableH = 1080
  // ratio = 1856/1080 ≈ 1.719
  // area = 307200
  // h = sqrt(307200 / 1.719) ≈ 422.7
  // w = 307200 / 422.7 ≈ 727.0
  const result = computeTileDimensions(1920, 1080, 32, 32);
  assert.ok(result.w > 700 && result.w < 750, `w=${result.w} should be ~727`);
  assert.ok(result.h > 400 && result.h < 450, `h=${result.h} should be ~423`);
});

test("computeTileDimensions adapts to narrow viewport (left panel open)", () => {
  // Left panel open: leftOffset=480
  // availableW = 1920 - 480 - 32 = 1408
  // ratio = 1408/1080 ≈ 1.304
  const wide = computeTileDimensions(1920, 1080, 32, 32);
  const narrow = computeTileDimensions(1920, 1080, 480, 32);
  assert.ok(narrow.w < wide.w, "narrower viewport should produce smaller W");
  assert.ok(narrow.h > wide.h, "narrower viewport should produce taller H");
});

test("computeTileDimensions preserves area", () => {
  const TARGET_AREA = 640 * 480;
  const result = computeTileDimensions(1920, 1080, 280, 32);
  const area = result.w * result.h;
  assert.ok(
    Math.abs(area - TARGET_AREA) < 1,
    `area=${area} should be ≈${TARGET_AREA}`,
  );
});

test("computeTileDimensions clamps to min/max bounds", () => {
  // Extremely narrow viewport
  const narrow = computeTileDimensions(600, 1080, 32, 32);
  assert.ok(narrow.w >= 400, `w=${narrow.w} should be >= 400`);
  assert.ok(narrow.h <= 700, `h=${narrow.h} should be <= 700`);

  // Extremely wide viewport
  const wide = computeTileDimensions(3840, 600, 32, 32);
  assert.ok(wide.w <= 900, `w=${wide.w} should be <= 900`);
  assert.ok(wide.h >= 300, `h=${wide.h} should be >= 300`);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/tile-dimensions-store.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/stores/tileDimensionsStore.ts`:

```typescript
import { create } from "zustand";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "./canvasStore";
import { getCanvasLeftInset, getCanvasRightInset } from "../canvas/viewportBounds";

const TARGET_AREA = 640 * 480; // 307200
const MIN_W = 400;
const MAX_W = 900;
const MIN_H = 300;
const MAX_H = 700;

export function computeTileDimensions(
  windowWidth: number,
  windowHeight: number,
  leftOffset: number,
  rightOffset: number,
): { w: number; h: number } {
  const availableW = Math.max(windowWidth - leftOffset - rightOffset, 200);
  const availableH = Math.max(windowHeight, 200);
  const ratio = availableW / availableH;

  let h = Math.sqrt(TARGET_AREA / ratio);
  let w = TARGET_AREA / h;

  w = Math.max(MIN_W, Math.min(MAX_W, w));
  h = Math.max(MIN_H, Math.min(MAX_H, TARGET_AREA / w));

  return { w: Math.round(w), h: Math.round(h) };
}

interface TileDimensionsStore {
  w: number;
  h: number;
  recalculate: () => void;
}

export const useTileDimensionsStore = create<TileDimensionsStore>((set) => ({
  w: 640,
  h: 480,
  recalculate: () => {
    const { leftPanelCollapsed, leftPanelWidth, rightPanelCollapsed } =
      useCanvasStore.getState();
    const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
    const rightOffset = getCanvasRightInset(rightPanelCollapsed);
    const dims = computeTileDimensions(
      window.innerWidth,
      window.innerHeight,
      leftOffset,
      rightOffset,
    );
    set(dims);
  },
}));
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/tile-dimensions-store.test.ts`
Expected: 4 tests PASS

**Step 5: Commit**

```bash
git add src/stores/tileDimensionsStore.ts tests/tile-dimensions-store.test.ts
git commit -m "feat: add tileDimensionsStore with dynamic W/H calculation"
```

---

### Task 2: Make layout functions accept dynamic W/H

**Files:**
- Modify: `src/layout.ts`
- Test: `tests/tile-dimensions-store.test.ts` (append)

**Step 1: Write the failing test**

Append to `tests/tile-dimensions-store.test.ts`:

```typescript
import { packTerminals, computeWorktreeSize, getStandardWorktreeWidth } from "../src/layout.ts";

test("packTerminals uses custom tile dimensions", () => {
  const spans = [{ cols: 1, rows: 1 }, { cols: 1, rows: 1 }];
  const defaultPacked = packTerminals(spans);
  const customPacked = packTerminals(spans, 3, { w: 500, h: 600 });

  // Default: x positions based on 640
  assert.equal(defaultPacked[0].w, 640);
  assert.equal(defaultPacked[0].h, 480);

  // Custom: x positions based on 500
  assert.equal(customPacked[0].w, 500);
  assert.equal(customPacked[0].h, 600);
  assert.equal(customPacked[1].x, 500 + 8); // GRID_GAP = 8
});

test("computeWorktreeSize uses custom tile dimensions", () => {
  const spans = [{ cols: 2, rows: 1 }];
  const size = computeWorktreeSize(spans, 3, { w: 500, h: 600 });
  // w = 2*500 + 1*8 + 10*2 = 1028
  assert.equal(size.w, 1028);
});

test("getStandardWorktreeWidth uses custom tile dimensions", () => {
  const width = getStandardWorktreeWidth(3, { w: 500, h: 600 });
  // 3*500 + 2*8 + 10*2 = 1536
  assert.equal(width, 1536);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/tile-dimensions-store.test.ts`
Expected: FAIL — functions don't accept tile dimension parameter

**Step 3: Modify `src/layout.ts`**

Add a `TileDims` interface. Add an optional `tileDims` parameter to `packTerminals`, `computeWorktreeSize`, `getWorktreeSize`, and `getStandardWorktreeWidth`. Default to `{ w: TERMINAL_W, h: TERMINAL_H }` when not provided, preserving backward compatibility.

```typescript
// Keep existing constants as defaults
export const TERMINAL_W = 640;
export const TERMINAL_H = 480;

export interface TileDims {
  w: number;
  h: number;
}

const DEFAULT_TILE_DIMS: TileDims = { w: TERMINAL_W, h: TERMINAL_H };
```

Update `packTerminals` signature:

```typescript
export function packTerminals(
  spans: TerminalSpan[],
  gridCols: number = DEFAULT_GRID_COLS,
  tileDims: TileDims = DEFAULT_TILE_DIMS,
): PackedTerminal[] {
```

Inside `packTerminals`, replace `TERMINAL_W` with `tileDims.w` and `TERMINAL_H` with `tileDims.h` (lines 94-97):

```typescript
    result.push({
      index: i,
      col,
      row,
      span: { cols: sCols, rows: sRows },
      x: col * (tileDims.w + GRID_GAP),
      y: row * (tileDims.h + GRID_GAP),
      w: sCols * tileDims.w + (sCols - 1) * GRID_GAP,
      h: sRows * tileDims.h + (sRows - 1) * GRID_GAP,
    });
```

Update `computeWorktreeSize` signature:

```typescript
export function computeWorktreeSize(
  spans: TerminalSpan[],
  gridCols?: number,
  tileDims: TileDims = DEFAULT_TILE_DIMS,
): { w: number; h: number } {
```

Inside, pass `tileDims` to `packTerminals` and replace constants:

```typescript
  const packed = packTerminals(spans, gridCols, tileDims);
  // ...
  const w = maxCol * tileDims.w + (maxCol - 1) * GRID_GAP + WT_PAD * 2;
  const h =
    WT_TITLE_H +
    WT_PAD +
    maxRow * tileDims.h +
    (maxRow - 1) * GRID_GAP +
    WT_PAD;
```

Update `getWorktreeSize`:

```typescript
export function getWorktreeSize(
  spans: TerminalSpan[],
  collapsed: boolean,
  gridCols?: number,
  tileDims: TileDims = DEFAULT_TILE_DIMS,
): { w: number; h: number } {
  if (collapsed) {
    return { w: WT_MIN_W, h: WT_TITLE_H };
  }
  return computeWorktreeSize(spans, gridCols, tileDims);
}
```

Update `getStandardWorktreeWidth`:

```typescript
export function getStandardWorktreeWidth(
  gridCols: number = DEFAULT_GRID_COLS,
  tileDims: TileDims = DEFAULT_TILE_DIMS,
): number {
  return gridCols * tileDims.w + Math.max(0, gridCols - 1) * GRID_GAP + WT_PAD * 2;
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/tile-dimensions-store.test.ts`
Expected: All tests PASS

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors (all existing callers still use defaults)

**Step 6: Commit**

```bash
git add src/layout.ts tests/tile-dimensions-store.test.ts
git commit -m "feat: add optional tileDims parameter to layout functions"
```

---

### Task 3: Wire reactive recalculation triggers

**Files:**
- Modify: `src/stores/tileDimensionsStore.ts`
- Create: `src/hooks/useTileDimensions.ts`

**Step 1: Create the hook**

Create `src/hooks/useTileDimensions.ts`:

```typescript
import { useEffect } from "react";
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";
import { useCanvasStore } from "../stores/canvasStore";

/**
 * Mount once at app root. Subscribes to window resize and panel state
 * changes, triggering tile dimension recalculation.
 */
export function useTileDimensionsSync() {
  const recalculate = useTileDimensionsStore((s) => s.recalculate);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);

  // Recalculate when panel state changes
  useEffect(() => {
    recalculate();
  }, [leftPanelCollapsed, leftPanelWidth, rightPanelCollapsed, recalculate]);

  // Recalculate on window resize
  useEffect(() => {
    const handleResize = () => recalculate();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [recalculate]);
}
```

**Step 2: Mount the hook**

Find the app root component (likely `App.tsx` or `Canvas.tsx`) and add:

```typescript
import { useTileDimensionsSync } from "../hooks/useTileDimensions";
// Inside the component:
useTileDimensionsSync();
```

Search for the right mount point by looking for where `useCanvasStore` is first used in a top-level component. The hook should be mounted once, high in the tree.

Check: `src/App.tsx` or `src/canvas/Canvas.tsx` — find the outermost component that renders the canvas.

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/hooks/useTileDimensions.ts src/App.tsx  # or wherever mounted
git commit -m "feat: wire tileDimensions recalculation to panel/resize events"
```

---

### Task 4: Thread dynamic tile dimensions through all consumers

This is the largest task. Every call site that uses `packTerminals`, `getWorktreeSize`, `getStandardWorktreeWidth` needs to pass the dynamic tile dimensions.

**Files:**
- Modify: `src/canvas/xyflowNodes.tsx`
- Modify: `src/canvas/XyFlowCanvas.tsx`
- Modify: `src/canvas/nodeProjection.ts`
- Modify: `src/containers/WorktreeContainer.tsx`
- Modify: `src/stores/projectStore.ts`
- Modify: `src/utils/panToTerminal.ts`
- Modify: `src/utils/panToWorktree.ts`
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/hooks/useBoxSelect.ts`
- Modify: `src/components/FamilyTreeOverlay.tsx`

**Strategy:** In React components/hooks, read from `useTileDimensionsStore`. In non-React code (store actions, utility functions), read from `useTileDimensionsStore.getState()`.

**Step 1: Update `src/canvas/xyflowNodes.tsx`**

Import the store:
```typescript
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";
import type { TileDims } from "../layout";
```

In `WorktreeTerminalItem` — no change needed (it receives `item` with pre-calculated w/h).

In `WorktreeNode` (the component that calls `packTerminals`):
```typescript
const tileDims = useTileDimensionsStore((s) => ({ w: s.w, h: s.h }));
// Then pass to packTerminals:
const packed = useMemo(() => packTerminals(spans, 3, tileDims), [spans, tileDims]);
const computedSize = useMemo(
  () => getWorktreeSize(spans, worktree?.collapsed ?? false, undefined, tileDims),
  [spans, worktree?.collapsed, tileDims],
);
```

Also update the drag handler's `packTerminals` call inside `handleTerminalDragStart` to pass `tileDims` (read from store via `useTileDimensionsStore.getState()`).

**Step 2: Update `src/canvas/XyFlowCanvas.tsx`**

In the `terminalEntries` useMemo (around line 130):
```typescript
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";

// Inside component:
const tileDims = useTileDimensionsStore((s) => ({ w: s.w, h: s.h }));

// In useMemo:
const packed = packTerminals(
  worktree.terminals.map((terminal) => terminal.span),
  3,
  tileDims,
);
```

Add `tileDims` to the useMemo dependency array.

**Step 3: Update `src/canvas/nodeProjection.ts`**

The `projectToFlowNodes` function is called from React, so it needs `tileDims` as a parameter:

```typescript
import type { TileDims } from "../layout";

export function projectToFlowNodes(
  projects: ProjectData[],
  tileDims?: TileDims,
): { ... } {
  // Pass tileDims to getWorktreeSize calls
  const size = getWorktreeSize(
    worktree.terminals.map((t) => t.span),
    worktree.collapsed,
    undefined,
    tileDims,
  );
```

Update the caller in `XyFlowCanvas.tsx` to pass `tileDims`.

**Step 4: Update `src/containers/WorktreeContainer.tsx`**

```typescript
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";

// Inside component:
const tileDims = useTileDimensionsStore((s) => ({ w: s.w, h: s.h }));
const packed = packTerminals(spans, 3, tileDims);
const computedSize = getWorktreeSize(spans, worktree.collapsed, undefined, tileDims);
```

Also pass `tileDims` in drag handler and zoom-to-fit `packTerminals` calls.

**Step 5: Update `src/stores/projectStore.ts`**

`COMPACT_ROW_WIDTH` at line 201 is computed at module level. Change it to a function:

```typescript
function getCompactRowWidth(): number {
  const { w, h } = useTileDimensionsStore.getState();
  return getStandardWorktreeWidth(DEFAULT_GRID_COLS, { w, h });
}
```

Replace all references to `COMPACT_ROW_WIDTH` with `getCompactRowWidth()`.

Also update `getVisibleWorktreeSize` to pass tile dims:

```typescript
function getVisibleWorktreeSize(worktree: WorktreeData) {
  const { w, h } = useTileDimensionsStore.getState();
  return getWorktreeSize(
    worktree.terminals.map((terminal) => terminal.span),
    worktree.collapsed,
    undefined,
    { w, h },
  );
}
```

**Step 6: Update `src/utils/panToTerminal.ts`**

In the fallback path (line 86-88):
```typescript
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";

const { w, h } = useTileDimensionsStore.getState();
const packed = packTerminals(
  focusedWorktree.terminals.map((terminal) => terminal.span),
  3,
  { w, h },
);
```

**Step 7: Update `src/utils/panToWorktree.ts`**

```typescript
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";

const { w, h } = useTileDimensionsStore.getState();
const wtSize = getWorktreeSize(spans, collapsed, undefined, { w, h });
```

**Step 8: Update `src/hooks/useKeyboardShortcuts.ts`**

Pass tile dims to any `packTerminals` calls.

**Step 9: Update `src/hooks/useBoxSelect.ts`**

Pass tile dims to `packTerminals` and `getWorktreeSize` calls.

**Step 10: Update `src/components/FamilyTreeOverlay.tsx`**

Pass tile dims to `packTerminals` call.

**Step 11: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 12: Commit**

```bash
git add -A
git commit -m "feat: thread dynamic tile dimensions through all layout consumers"
```

---

### Task 5: Add CSS transition animation for smooth tile resizing

**Files:**
- Modify: `src/terminal/TerminalTile.tsx`
- Modify: `src/canvas/xyflowNodes.tsx` (worktree container size transition)

**Step 1: Update TerminalTile transition**

In `src/terminal/TerminalTile.tsx` around line 555, change the existing transition:

```typescript
// Before:
transition: isDragging ? "none" : "left 0.2s ease, top 0.2s ease",

// After:
transition: isDragging ? "none" : "left 0.2s ease, top 0.2s ease, width 0.2s ease, height 0.2s ease",
```

**Step 2: Debounce xterm refit to after transition**

In `src/terminal/TerminalTile.tsx`, modify the fit effect (around line 317-325):

```typescript
useEffect(() => {
  if (terminal.minimized || lodMode !== "live") return;

  // Wait for CSS transition to finish before refitting
  const timer = setTimeout(() => {
    fitTerminalRuntime(terminal.id);
  }, 220); // slightly longer than 200ms transition

  return () => clearTimeout(timer);
}, [height, lodMode, terminal.id, terminal.minimized, width]);
```

**Step 3: Add transition to worktree container size**

In `src/canvas/nodeProjection.ts`, the worktree node style sets `width` and `height`. The ReactFlow node renderer applies these. Check if ReactFlow supports CSS transitions on node resize — if yes, add transition via `style` or `className`. If not, this may need to be handled at the `xyflowNodes.tsx` level where the worktree body div has explicit height (line 494-496):

```typescript
style={{
  height: worktree.collapsed ? 0 : computedSize.h - WT_TITLE_H,
  transition: "height 0.2s ease",
  padding: worktree.collapsed ? 0 : undefined,
}}
```

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Manual test**

1. Open the app
2. Open/close the left panel — tiles should smoothly resize
3. Drag the left panel wider — tiles should smoothly adapt
4. Focus a terminal — verify it fills the viewport better
5. Check that xterm content refits after transition (no mid-animation flicker)

**Step 6: Commit**

```bash
git add src/terminal/TerminalTile.tsx src/canvas/xyflowNodes.tsx src/canvas/nodeProjection.ts
git commit -m "feat: smooth CSS transition for tile resize, debounce xterm refit"
```

---

### Task 6: Re-pan focused terminal after tile dimensions change

**Files:**
- Modify: `src/hooks/useTileDimensions.ts`

When tile dimensions change while a terminal is focused, the viewport should re-center on it (since tile geometry changed).

**Step 1: Add re-pan logic to the hook**

```typescript
import { useEffect, useRef } from "react";
import { useTileDimensionsStore } from "../stores/tileDimensionsStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { panToTerminal } from "../utils/panToTerminal";

export function useTileDimensionsSync() {
  const recalculate = useTileDimensionsStore((s) => s.recalculate);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const isFirstRender = useRef(true);

  useEffect(() => {
    recalculate();

    // Skip re-pan on initial mount
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Re-pan to focused terminal after dimensions change
    const timer = setTimeout(() => {
      const focusedTerminalId = findFocusedTerminalId();
      if (focusedTerminalId) {
        panToTerminal(focusedTerminalId);
      }
    }, 250); // after transition completes

    return () => clearTimeout(timer);
  }, [leftPanelCollapsed, leftPanelWidth, rightPanelCollapsed, recalculate]);

  useEffect(() => {
    const handleResize = () => {
      recalculate();
      const timer = setTimeout(() => {
        const focusedTerminalId = findFocusedTerminalId();
        if (focusedTerminalId) {
          panToTerminal(focusedTerminalId);
        }
      }, 250);
      return () => clearTimeout(timer);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [recalculate]);
}

function findFocusedTerminalId(): string | null {
  const { projects } = useProjectStore.getState();
  for (const p of projects) {
    for (const w of p.worktrees) {
      const focused = w.terminals.find((t) => t.focused);
      if (focused) return focused.id;
    }
  }
  return null;
}
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/hooks/useTileDimensions.ts
git commit -m "feat: re-pan focused terminal after tile dimensions change"
```

---

### Task 7: Final integration test and cleanup

**Files:**
- Modify: `tests/tile-dimensions-store.test.ts` (add edge case tests)

**Step 1: Add edge case tests**

Append to `tests/tile-dimensions-store.test.ts`:

```typescript
test("computeTileDimensions handles zero-width gracefully", () => {
  // Edge case: panel wider than window
  const result = computeTileDimensions(400, 1080, 500, 32);
  assert.ok(result.w >= 400, "w should be clamped to min");
  assert.ok(result.h >= 300, "h should be clamped to min");
});

test("packTerminals with custom dims produces correct 2x1 span", () => {
  const packed = packTerminals([{ cols: 2, rows: 1 }], 3, { w: 500, h: 600 });
  assert.equal(packed[0].w, 2 * 500 + 8); // 1008
  assert.equal(packed[0].h, 600);
});

test("default packTerminals still works without tileDims", () => {
  const packed = packTerminals([{ cols: 1, rows: 1 }]);
  assert.equal(packed[0].w, 640);
  assert.equal(packed[0].h, 480);
});
```

**Step 2: Run all tests**

Run: `npx tsx --test tests/tile-dimensions-store.test.ts`
Expected: All PASS

**Step 3: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Final commit**

```bash
git add tests/tile-dimensions-store.test.ts
git commit -m "test: add edge case tests for dynamic tile dimensions"
```
