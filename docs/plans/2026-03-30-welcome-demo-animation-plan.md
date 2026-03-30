# Welcome Demo Animation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the interactive WelcomePopup tutorial with an auto-playing animation demo that showcases TermCanvas features via a simulated UI with synced keystroke hints.

**Architecture:** Single async/await timeline function drives ~7 animation phases. ~15 useState variables control UI state. CSS transitions handle visual interpolation. All code stays in one self-contained file (`WelcomePopup.tsx`).

**Tech Stack:** React, TypeScript, CSS transitions, SVG cursor. No animation libraries.

**Design doc:** `docs/plans/2026-03-30-welcome-demo-animation-design.md`

---

### Task 1: Strip old tutorial, build static shell

Remove all interactive tutorial logic and build the new static layout (sidebar + canvas + tiles + keystroke bar) with no animation yet. Verify it renders correctly.

**Files:**
- Rewrite: `src/components/WelcomePopup.tsx`

**Step 1: Read the current file**

Read `src/components/WelcomePopup.tsx` (562 lines) to understand all imports and exports.

**Step 2: Rewrite WelcomePopup.tsx with static demo shell**

Replace the entire file. Keep these imports:
```typescript
import { useState, useEffect, useRef } from "react";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";
```

Remove: `useCallback`, `MouseEvent`, `WheelEvent`, `matchesShortcut`.

Build these sub-components (all in the same file):

1. **`Bi`** — keep as-is (bilingual text, cyan EN + amber ZH)

2. **`DemoCursor`** — SVG arrow cursor, absolute positioned
   - Props: `pos: { x: number; y: number }`, `dragging: boolean`
   - Renders an SVG arrow at `left: pos.x, top: pos.y`
   - CSS class toggles transition on/off based on `dragging`

3. **`DemoTile`** — single terminal placeholder tile
   - Props: `name: string`, `color: string`, `lines: { text: string; color: string }[]`, `focused: boolean`, `visible: boolean`
   - 120×80 box with title bar (color dot + name) and 2 lines of placeholder text
   - Focused state: blue border + glow shadow
   - Visible state: opacity + scale transition for stagger entrance

4. **`DemoSidebar`** — left sidebar placeholder
   - Fixed width 44px, 4-5 colored bars + a logo placeholder square

5. **`DemoPanel`** — right panel placeholder
   - Props: `visible: boolean`, `content: 'usage' | 'hydra'`
   - Width 180px, slides in from right with translateX
   - Usage content: 3 gray bar placeholders (chart) + a number block
   - Hydra content: 2 status pill placeholders + a progress bar

6. **`KeystrokeBar`** — bottom keystroke display
   - Props: `keystroke: { key: string; en: string; zh: string } | null`
   - Key shown as rounded pill badge, label in Bi style
   - Fade transition on content change

7. **`WelcomePopup`** — main component (exported)
   - Props: `{ onClose: () => void }` (same as current)
   - Renders: backdrop → modal (max-w 800px) → title bar → DemoStage (flex row: sidebar + canvas area + panel) → keystroke bar → bottom controls
   - Canvas area: relative container with `var(--surface)` bg, dot grid pattern, 4 DemoTile in a 2×2 grid centered, DemoCursor on top
   - Bottom controls: just a close hint for now ("Escape to close")
   - State: only `isFinished: false` for now, no animation yet

**Step 3: Type-check**

Run: `npm run typecheck`
Expected: no errors

**Step 4: Visual verify**

Run: `npm run dev`, open the app, clear `termcanvas-welcome-seen` from localStorage, reload.
Verify: modal appears with sidebar, 4 tiles in 2×2 grid, dot grid background, keystroke bar at bottom (empty), cursor visible at center. No animation.

**Step 5: Commit**

```bash
git add src/components/WelcomePopup.tsx
git commit -m "refactor: replace interactive tutorial with static demo shell"
```

---

### Task 2: Animation timeline — Phase 1 (Intro) and Phase 2 (Focus)

Add the core animation infrastructure: `delay()`, `runAnimation()`, cancellation, and implement the first two phases.

**Files:**
- Modify: `src/components/WelcomePopup.tsx`

**Step 1: Add animation state and infrastructure**

Add these useState to WelcomePopup:
```typescript
const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
const [focusedTile, setFocusedTile] = useState(-1);
const [tilesVisible, setTilesVisible] = useState([false, false, false, false]);
const [canvasTransform, setCanvasTransform] = useState({ x: 0, y: 0, scale: 1 });
const [keystroke, setKeystroke] = useState<{ key: string; en: string; zh: string } | null>(null);
const [isPlaying, setIsPlaying] = useState(true);
const [isFinished, setIsFinished] = useState(false);
```

Add a `stageRef` on the canvas area container, used to compute tile positions via `getBoundingClientRect()`.

Add the delay helper inside the useEffect:
```typescript
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
```

**Step 2: Implement Phase 1 (Intro) + Phase 2 (Focus)**

Inside a `useEffect` keyed on `[isPlaying]`:

```typescript
useEffect(() => {
  if (!isPlaying) return;
  let cancelled = false;

  const run = async () => {
    // Reset
    setIsFinished(false);
    setFocusedTile(-1);
    setTilesVisible([false, false, false, false]);
    setCanvasTransform({ x: 0, y: 0, scale: 1 });
    setKeystroke(null);
    setCursorPos({ x: CENTER_X, y: CENTER_Y });

    await delay(300);
    if (cancelled) return;

    // Phase 1: Intro — stagger tiles in
    for (let i = 0; i < 4; i++) {
      if (cancelled) return;
      setTilesVisible(prev => { const next = [...prev]; next[i] = true; return next; });
      await delay(150);
    }
    await delay(800);
    if (cancelled) return;

    // Phase 2: Focus — cursor moves to tile 0, focus it, zoom in
    setCursorPos(TILE_CENTERS[0]); // pre-computed center of tile 0
    await delay(400);
    if (cancelled) return;
    setKeystroke({ key: fmtClearFocus, en: "Toggle Focus", zh: "切换聚焦" });
    await delay(300);
    if (cancelled) return;
    setFocusedTile(0);
    setCanvasTransform({ x: -TILE_OFFSETS[0].x, y: -TILE_OFFSETS[0].y, scale: 1.3 });
    await delay(1500);
    if (cancelled) return;

    // ... phases 3-7 in next tasks
    setIsFinished(true);
    setIsPlaying(false);
  };

  run();
  return () => { cancelled = true; };
}, [isPlaying]);
```

`TILE_CENTERS` and `TILE_OFFSETS` are constants computed from the 2×2 grid layout (same pattern as the old `CELL_OFFSETS`).

Wire the state to the sub-components:
- Pass `cursorPos` and a `dragging={false}` to DemoCursor
- Pass `focused={focusedTile === i}` and `visible={tilesVisible[i]}` to each DemoTile
- Pass `canvasTransform` as CSS transform on the tiles grid container
- Pass `keystroke` to KeystrokeBar

**Step 3: Type-check**

Run: `npm run typecheck`

**Step 4: Visual verify**

Open app, clear localStorage, reload. Verify:
- Tiles stagger in one by one
- Cursor slides to first tile
- Keystroke bar shows "⌘ E · Toggle Focus · 切换聚焦"
- Tile 0 gets blue glow
- Canvas zooms in toward tile 0
- Animation stops (isFinished = true)

**Step 5: Commit**

```bash
git add src/components/WelcomePopup.tsx
git commit -m "feat: add animation timeline with intro and focus phases"
```

---

### Task 3: Animation timeline — Phase 3 (Switch) and Phase 4 (Unfocus)

**Files:**
- Modify: `src/components/WelcomePopup.tsx`

**Step 1: Add Phase 3 and Phase 4 to runAnimation**

After Phase 2, continue:

```typescript
// Phase 3: Switch terminals — focus jumps through build, git, test
setKeystroke({ key: fmtNext, en: "Next Terminal", zh: "下一终端" });
for (const idx of [1, 2, 3]) {
  if (cancelled) return;
  setFocusedTile(idx);
  setCursorPos(TILE_CENTERS[idx]);
  setCanvasTransform({ x: -TILE_OFFSETS[idx].x, y: -TILE_OFFSETS[idx].y, scale: 1.3 });
  await delay(1000);
}
if (cancelled) return;

// Phase 4: Unfocus — release focus, zoom back
setKeystroke({ key: fmtClearFocus, en: "Toggle Focus", zh: "切换聚焦" });
await delay(300);
if (cancelled) return;
setFocusedTile(-1);
setCanvasTransform({ x: 0, y: 0, scale: 1 });
await delay(1500);
if (cancelled) return;
```

**Step 2: Type-check**

Run: `npm run typecheck`

**Step 3: Visual verify**

Reload app. Verify after Phase 2: focus jumps build → git → test with cursor tracking, then unfocuses and zooms back to overview.

**Step 4: Commit**

```bash
git add src/components/WelcomePopup.tsx
git commit -m "feat: add terminal switching and unfocus animation phases"
```

---

### Task 4: Animation timeline — Phase 5 (Zoom/Pan)

**Files:**
- Modify: `src/components/WelcomePopup.tsx`

**Step 1: Add Phase 5 to runAnimation**

After Phase 4:

```typescript
// Phase 5: Zoom/Pan
setKeystroke({ key: "Scroll", en: "Zoom", zh: "缩放" });
await delay(300);
if (cancelled) return;

// Simulate zoom out
setCanvasTransform({ x: 0, y: 0, scale: 0.7 });
await delay(800);
if (cancelled) return;

// Simulate drag pan (use a for loop for smooth motion)
setKeystroke({ key: "Drag", en: "Pan", zh: "平移" });
const PAN_STEPS = 16;
for (let i = 1; i <= PAN_STEPS; i++) {
  if (cancelled) return;
  const progress = i / PAN_STEPS;
  const panX = Math.sin(progress * Math.PI) * 30; // arc motion
  setCursorPos({ x: CENTER_X + panX, y: CENTER_Y });
  setCanvasTransform({ x: panX, y: 0, scale: 0.7 });
  await delay(25);
}
if (cancelled) return;

// Zoom back to normal
setKeystroke({ key: "Scroll", en: "Zoom", zh: "缩放" });
setCanvasTransform({ x: 0, y: 0, scale: 1 });
setCursorPos({ x: CENTER_X, y: CENTER_Y });
await delay(800);
if (cancelled) return;
```

Note: During the drag pan loop, DemoCursor needs `dragging={true}` so its CSS transition is disabled. Add a `isDragging` state and set it around the loop.

**Step 2: Type-check**

Run: `npm run typecheck`

**Step 3: Visual verify**

Reload. After unfocus phase: canvas zooms out, cursor drags sideways (smooth arc), then zooms back to normal.

**Step 4: Commit**

```bash
git add src/components/WelcomePopup.tsx
git commit -m "feat: add zoom and pan animation phase"
```

---

### Task 5: Animation timeline — Phase 6 (Panel) and Phase 7 (Finish)

**Files:**
- Modify: `src/components/WelcomePopup.tsx`

**Step 1: Add Phase 6 and Phase 7**

```typescript
// Phase 6: Right Panel
const fmtTogglePanel = formatShortcut(shortcuts.toggleRightPanel, isMac);
setKeystroke({ key: fmtTogglePanel, en: "Toggle Panel", zh: "切换面板" });
await delay(300);
if (cancelled) return;
setPanelVisible(true);
setPanelContent("usage");
await delay(2000);
if (cancelled) return;

// Switch to Hydra view
setPanelContent("hydra");
await delay(1500);
if (cancelled) return;

// Phase 7: Finish
setPanelVisible(false);
await delay(400);
if (cancelled) return;
const fmtAddProject = formatShortcut(shortcuts.addProject, isMac);
setKeystroke({ key: fmtAddProject, en: "Add Project", zh: "添加项目" });
await delay(1500);
if (cancelled) return;

setIsFinished(true);
setIsPlaying(false);
```

**Step 2: Add Replay button**

In the bottom controls area, when `isFinished` is true, show a Replay button:

```tsx
{isFinished && (
  <button
    className="text-[12px] text-[var(--accent)] hover:underline"
    onClick={() => { setIsFinished(false); setIsPlaying(true); }}
  >
    <Bi en="Replay" zh="重播" />
  </button>
)}
```

Also show the close hint: `<Bi en="Escape to close" zh="Escape 关闭" />`

**Step 3: Type-check**

Run: `npm run typecheck`

**Step 4: Visual verify**

Full animation playthrough: intro → focus → switch → unfocus → zoom/pan → panel (usage → hydra) → finish. Replay button appears at end. Click Replay to verify it restarts. Escape closes the modal.

**Step 5: Commit**

```bash
git add src/components/WelcomePopup.tsx
git commit -m "feat: add panel phase, finish phase, and replay button"
```

---

### Task 6: Lifecycle — visibility, reduced motion, cleanup

**Files:**
- Modify: `src/components/WelcomePopup.tsx`

**Step 1: Add visibilitychange handler**

Inside WelcomePopup, add a separate useEffect:

```typescript
useEffect(() => {
  const handler = () => {
    if (document.hidden) {
      // Cancel current animation by toggling isPlaying off
      setIsPlaying(false);
    } else {
      // Restart from beginning
      setIsPlaying(true);
    }
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}, []);
```

**Step 2: Add reduced motion support**

At the top of WelcomePopup:

```typescript
const prefersReducedMotion = useRef(
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
);
```

If `prefersReducedMotion.current` is true, skip the animation entirely: set all tiles visible, no cursor, show a static shortcut list instead of the animated keystroke bar. Render a simplified view similar to the old step 0 welcome screen but with the new layout.

**Step 3: Escape/backdrop/close handlers**

Add a `useEffect` for keydown:

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}, [onClose]);
```

Backdrop click on the outer div (same pattern as current implementation with backdropRef).

**Step 4: Type-check**

Run: `npm run typecheck`

**Step 5: Visual verify**

- Switch tabs during animation → comes back to restart
- Escape closes modal
- Click backdrop closes modal
- (Optionally test reduced motion in DevTools → Rendering → Emulate prefers-reduced-motion)

**Step 6: Commit**

```bash
git add src/components/WelcomePopup.tsx
git commit -m "feat: add visibility handling, reduced motion, and close handlers"
```

---

### Task 7: Clean up unused i18n strings

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

**Step 1: Remove unused onboarding strings**

Remove from both `en.ts` and `zh.ts` all keys that were only used by the old interactive tutorial:
- `onboarding_dblclick_prompt`
- `onboarding_focus_prompt`
- `onboarding_unfocus_prompt`
- `onboarding_switch_prompt`
- `onboarding_switch_continue`
- `onboarding_zoom_prompt`
- `onboarding_zoom_continue`
- `onboarding_complete`
- `onboarding_complete_dismiss`
- `onboarding_skip`

Keep `welcome_*` strings if they are still referenced (check the new WelcomePopup code). If any `welcome_*` strings are also no longer used, remove them too.

**Step 2: Verify no broken references**

Run: `npm run typecheck`

Search the codebase for any remaining references to the removed keys:
```bash
grep -r "onboarding_dblclick_prompt\|onboarding_focus_prompt\|onboarding_unfocus_prompt\|onboarding_switch_prompt\|onboarding_switch_continue\|onboarding_zoom_prompt\|onboarding_zoom_continue\|onboarding_complete\b\|onboarding_complete_dismiss\|onboarding_skip" src/
```
Expected: no matches.

**Step 3: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh.ts
git commit -m "chore: remove unused onboarding i18n strings"
```

---

### Task 8: Visual polish pass

**Files:**
- Modify: `src/components/WelcomePopup.tsx`

**Step 1: Polish visual details**

Go through each sub-component and refine:

- **DemoTile**: ensure the stagger entrance uses scale(0.95) → scale(1) + opacity for a subtle pop-in effect
- **DemoCursor**: verify drop-shadow looks good on both dark and light themes
- **KeystrokeBar**: ensure the key pill has adequate contrast, fade transition feels smooth
- **DemoPanel**: verify SPRING_IN slide-in feels snappy but not jarring, placeholder bars have subtle rounded corners
- **Canvas transform**: ensure zoom transitions use `cubic-bezier(0.25, 0.46, 0.45, 0.94)` (matching existing MiniCanvas pattern)
- **Overall timing**: watch the full animation 3+ times and adjust delay values if any phase feels rushed or draggy

**Step 2: Test both themes**

Toggle between dark and light theme. All placeholder blocks should use CSS variables (`var(--surface)`, `var(--border)`, etc.) so they adapt automatically. Fix any that don't.

**Step 3: Test responsive**

Resize the window narrow. The modal should remain usable at 640px width. The 2×2 tile grid may need to shrink slightly. Add a `@media (max-width: 640px)` section or Tailwind responsive classes if needed.

**Step 4: Type-check + build**

Run: `npm run typecheck && npm run build`
Expected: no errors, clean build.

**Step 5: Commit**

```bash
git add src/components/WelcomePopup.tsx
git commit -m "style: polish demo animation visuals and timing"
```
