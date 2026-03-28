# Dynamic Clamp Centering — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Center focused terminals relative to the full screen width, clamping to avoid occlusion by either panel.

**Architecture:** Extract a shared `clampCenterX` helper in `viewportBounds.ts` that computes the ideal full-screen center then clamps against left/right panel edges with safe padding. Update the three call sites in `panToTerminal.ts` and `panToWorktree.ts` to use it.

**Tech Stack:** TypeScript, Zustand (canvasStore)

---

### Task 1: Add `getCanvasLeftInset` and `clampCenterX` to viewportBounds.ts

**Files:**
- Modify: `src/canvas/viewportBounds.ts`

**Step 1: Add `getCanvasLeftInset` helper**

Add below the existing `getCanvasRightInset`:

```typescript
export function getCanvasLeftInset(
  leftPanelCollapsed: boolean,
  leftPanelWidth: number,
) {
  return leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;
}
```

**Step 2: Add `clampCenterX` helper**

Add at the bottom of the file:

```typescript
const PAN_SAFE_PADDING = 40;

/**
 * Compute a clamped horizontal viewport translation that centres an object
 * on the full screen, then shifts just enough so neither panel occludes it.
 *
 * @param objectX   – world-space left edge of the object
 * @param objectW   – world-space width of the object
 * @param scale     – current zoom scale
 * @param leftInset – screen-space left panel width (px)
 * @param rightInset – screen-space right panel width (px)
 */
export function clampCenterX(
  objectX: number,
  objectW: number,
  scale: number,
  leftInset: number,
  rightInset: number,
): number {
  // Step 1 — ideal: centre on full screen width
  const objectCenterWorld = objectX + objectW / 2;
  let cx = -objectCenterWorld * scale + window.innerWidth / 2;

  // Step 2 — left clamp
  const screenLeft = cx + objectX * scale;
  const safeLeft = leftInset + PAN_SAFE_PADDING;
  if (screenLeft < safeLeft) {
    cx += safeLeft - screenLeft;
  }

  // Step 3 — right clamp
  const screenRight = cx + (objectX + objectW) * scale;
  const safeRight = window.innerWidth - rightInset - PAN_SAFE_PADDING;
  if (screenRight > safeRight) {
    cx -= screenRight - safeRight;
  }

  return cx;
}
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/canvas/viewportBounds.ts
git commit -m "feat: add clampCenterX helper for dynamic panel-aware centering"
```

---

### Task 2: Update panToTerminal.ts — published geometry path

**Files:**
- Modify: `src/utils/panToTerminal.ts:1-45`

**Step 1: Add imports**

Add `getCanvasLeftInset` and `clampCenterX` to the existing import from `viewportBounds`:

```typescript
import { getCanvasRightInset, getCanvasLeftInset, clampCenterX } from "../canvas/viewportBounds";
```

**Step 2: Replace centerX calculation (lines 20-30)**

Replace the existing block:

```typescript
    const { rightPanelCollapsed } = useCanvasStore.getState();
    const rightOffset = getCanvasRightInset(rightPanelCollapsed);
    const padding = 60;
    const viewW = window.innerWidth - rightOffset - padding * 2;
    const viewH = window.innerHeight - padding * 2;
    const scale =
      Math.min(viewW / publishedGeometry.w, viewH / publishedGeometry.h) * 0.85;

    const centerX =
      -(publishedGeometry.x + publishedGeometry.w / 2) * scale +
      (window.innerWidth - rightOffset) / 2;
```

With:

```typescript
    const { rightPanelCollapsed, leftPanelCollapsed, leftPanelWidth } =
      useCanvasStore.getState();
    const rightOffset = getCanvasRightInset(rightPanelCollapsed);
    const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
    const padding = 60;
    const viewW = window.innerWidth - rightOffset - padding * 2;
    const viewH = window.innerHeight - padding * 2;
    const scale =
      Math.min(viewW / publishedGeometry.w, viewH / publishedGeometry.h) * 0.85;

    const centerX = clampCenterX(
      publishedGeometry.x,
      publishedGeometry.w,
      scale,
      leftOffset,
      rightOffset,
    );
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/utils/panToTerminal.ts
git commit -m "feat: use clampCenterX in panToTerminal published-geometry path"
```

---

### Task 3: Update panToTerminal.ts — fallback layout path

**Files:**
- Modify: `src/utils/panToTerminal.ts:90-102`

**Step 1: Replace centerX calculation (lines 92-99)**

Replace:

```typescript
      const { rightPanelCollapsed } = useCanvasStore.getState();
      const rightOffset = getCanvasRightInset(rightPanelCollapsed);
      const padding = 60;
      const viewW = window.innerWidth - rightOffset - padding * 2;
      const viewH = window.innerHeight - padding * 2;
      const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

      const centerX = -(absX + item.w / 2) * scale + (window.innerWidth - rightOffset) / 2;
```

With:

```typescript
      const { rightPanelCollapsed, leftPanelCollapsed, leftPanelWidth } =
        useCanvasStore.getState();
      const rightOffset = getCanvasRightInset(rightPanelCollapsed);
      const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
      const padding = 60;
      const viewW = window.innerWidth - rightOffset - padding * 2;
      const viewH = window.innerHeight - padding * 2;
      const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

      const centerX = clampCenterX(absX, item.w, scale, leftOffset, rightOffset);
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/utils/panToTerminal.ts
git commit -m "feat: use clampCenterX in panToTerminal fallback layout path"
```

---

### Task 4: Update panToWorktree.ts

**Files:**
- Modify: `src/utils/panToWorktree.ts`

**Step 1: Replace imports**

Replace:

```typescript
import { useCanvasStore, RIGHT_PANEL_WIDTH, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
```

With:

```typescript
import { useCanvasStore } from "../stores/canvasStore";
import { getCanvasRightInset, getCanvasLeftInset, clampCenterX } from "../canvas/viewportBounds";
```

**Step 2: Replace centerX calculation (lines 28-36)**

Replace:

```typescript
  const { rightPanelCollapsed } = useCanvasStore.getState();
  const rightOffset = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;
  const padding = 60;
  const viewW = window.innerWidth - rightOffset - padding * 2;
  const viewH = window.innerHeight - padding * 2;
  const scale = Math.min(viewW / size.w, viewH / size.h) * 0.85;

  const centerX = -(absX + size.w / 2) * scale + (window.innerWidth - rightOffset) / 2;
  const centerY = -(absY + size.h / 2) * scale + window.innerHeight / 2;
```

With:

```typescript
  const { rightPanelCollapsed, leftPanelCollapsed, leftPanelWidth } =
    useCanvasStore.getState();
  const rightOffset = getCanvasRightInset(rightPanelCollapsed);
  const leftOffset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const padding = 60;
  const viewW = window.innerWidth - rightOffset - padding * 2;
  const viewH = window.innerHeight - padding * 2;
  const scale = Math.min(viewW / size.w, viewH / size.h) * 0.85;

  const centerX = clampCenterX(absX, size.w, scale, leftOffset, rightOffset);
  const centerY = -(absY + size.h / 2) * scale + window.innerHeight / 2;
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/utils/panToWorktree.ts
git commit -m "feat: use clampCenterX in panToWorktree"
```

---

### Task 5: Final type check and manual verification

**Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 2: Manual test**

1. Open the app, expand the left panel
2. Click a terminal in the left panel list → verify it centres closer to screen midpoint
3. Expand a very wide terminal → verify it doesn't go behind the left panel
4. Collapse the left panel → verify centering behaviour is unchanged from before
5. Test with right panel open/closed as well
