# Terminal Grid Span Resizing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow per-terminal grid span resizing (1x1, 2x1, 1x2, 2x2) with bin-packing layout, replacing hardcoded 540x260 with 80col x 24row base cell.

**Architecture:** Extend `TerminalData` with a `span` field. Replace the uniform-grid layout functions in `layout.ts` with a bin-packing algorithm that respects per-terminal spans. Add right-click context menu and keyboard shortcuts for span switching.

**Tech Stack:** React, Zustand, TypeScript, xterm.js

---

### Task 1: Data model — add `span` to TerminalData

**Files:**
- Modify: `src/types/index.ts:28-38`

**Step 1: Add span field to TerminalData**

In `src/types/index.ts`, add `span` to the `TerminalData` interface:

```ts
export interface TerminalData {
  id: string;
  title: string;
  type: TerminalType;
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
  status: TerminalStatus;
  scrollback?: string;
  sessionId?: string;
  span: { cols: number; rows: number };
}
```

**Step 2: Update createTerminal in projectStore.ts**

In `src/stores/projectStore.ts`, update `createTerminal` to set default span based on type:

```ts
const DEFAULT_SPAN: Record<TerminalType, { cols: number; rows: number }> = {
  shell: { cols: 1, rows: 1 },
  claude: { cols: 2, rows: 1 },
  codex: { cols: 2, rows: 1 },
  kimi: { cols: 2, rows: 1 },
  gemini: { cols: 2, rows: 1 },
  opencode: { cols: 2, rows: 1 },
};

export function createTerminal(
  type: TerminalType = "shell",
  title?: string,
): TerminalData {
  return {
    id: generateId(),
    title: title ?? (type === "shell" ? "Terminal" : type),
    type,
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    span: DEFAULT_SPAN[type],
  };
}
```

**Step 3: Add updateTerminalSpan action to projectStore**

Add to the `ProjectStore` interface and implementation:

```ts
// Interface
updateTerminalSpan: (
  projectId: string,
  worktreeId: string,
  terminalId: string,
  span: { cols: number; rows: number },
) => void;

// Implementation
updateTerminalSpan: (projectId, worktreeId, terminalId, span) =>
  set((state) => ({
    projects: resolveOverlaps(
      mapTerminals(state.projects, projectId, worktreeId, terminalId, (t) => ({
        ...t,
        span,
      })),
    ),
  })),
```

**Step 4: Update migration in App.tsx**

In `src/App.tsx`, update `migrateProjects` to add default span for existing terminals:

```ts
// Inside the terminal mapping in migrateProjects:
span: t.span ?? { cols: 1, rows: 1 },
```

**Step 5: Commit**

```
git add src/types/index.ts src/stores/projectStore.ts src/App.tsx
git commit -m "Add span field to TerminalData with per-type defaults"
```

---

### Task 2: Layout algorithm — new base size + bin-packing

**Files:**
- Modify: `src/layout.ts`

**Step 1: Update base cell size and rewrite layout functions**

Replace the entire `src/layout.ts` with:

```ts
export const TERMINAL_W = 640;
export const TERMINAL_H = 480;
export const GRID_GAP = 8;

export const WT_PAD = 10;
export const WT_TITLE_H = 36;

export const PROJ_PAD = 12;
export const PROJ_TITLE_H = 40;

export const DEFAULT_GRID_COLS = 3;

export interface TerminalSpan {
  cols: number;
  rows: number;
}

export interface PackedTerminal {
  index: number;
  col: number;
  row: number;
  span: TerminalSpan;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Bin-packing layout: place terminals into a grid respecting their spans.
 * Returns position and pixel size for each terminal.
 */
export function packTerminals(
  spans: TerminalSpan[],
  gridCols: number = DEFAULT_GRID_COLS,
): PackedTerminal[] {
  if (spans.length === 0) return [];

  // occupied[row][col] = true if cell is taken
  const occupied: boolean[][] = [];

  function isOccupied(r: number, c: number): boolean {
    return !!occupied[r]?.[c];
  }

  function markOccupied(r: number, c: number, spanCols: number, spanRows: number) {
    for (let dr = 0; dr < spanRows; dr++) {
      for (let dc = 0; dc < spanCols; dc++) {
        if (!occupied[r + dr]) occupied[r + dr] = [];
        occupied[r + dr][c + dc] = true;
      }
    }
  }

  function findPosition(spanCols: number, spanRows: number): { col: number; row: number } {
    for (let r = 0; ; r++) {
      for (let c = 0; c <= gridCols - spanCols; c++) {
        let fits = true;
        for (let dr = 0; dr < spanRows && fits; dr++) {
          for (let dc = 0; dc < spanCols && fits; dc++) {
            if (isOccupied(r + dr, c + dc)) fits = false;
          }
        }
        if (fits) return { col: c, row: r };
      }
    }
  }

  const result: PackedTerminal[] = [];

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    // Clamp span to grid width
    const sCols = Math.min(span.cols, gridCols);
    const sRows = span.rows;

    const { col, row } = findPosition(sCols, sRows);
    markOccupied(row, col, sCols, sRows);

    result.push({
      index: i,
      col,
      row,
      span: { cols: sCols, rows: sRows },
      x: col * (TERMINAL_W + GRID_GAP),
      y: row * (TERMINAL_H + GRID_GAP),
      w: sCols * TERMINAL_W + (sCols - 1) * GRID_GAP,
      h: sRows * TERMINAL_H + (sRows - 1) * GRID_GAP,
    });
  }

  return result;
}

/**
 * Compute worktree container size from packed terminal layout.
 */
export function computeWorktreeSize(spans: TerminalSpan[], gridCols?: number): {
  w: number;
  h: number;
} {
  if (spans.length === 0)
    return { w: 300, h: WT_TITLE_H + WT_PAD + 60 + WT_PAD };

  const packed = packTerminals(spans, gridCols);
  let maxCol = 0;
  let maxRow = 0;
  for (const p of packed) {
    maxCol = Math.max(maxCol, p.col + p.span.cols);
    maxRow = Math.max(maxRow, p.row + p.span.rows);
  }

  const w = maxCol * TERMINAL_W + (maxCol - 1) * GRID_GAP + WT_PAD * 2;
  const h = WT_TITLE_H + WT_PAD + maxRow * TERMINAL_H + (maxRow - 1) * GRID_GAP + WT_PAD;
  return { w, h };
}
```

Note: `computeGridCols` and `computeTerminalPosition` are removed. All callers will use `packTerminals` instead.

**Step 2: Commit**

```
git add src/layout.ts
git commit -m "Replace uniform grid layout with bin-packing algorithm"
```

---

### Task 3: Update callers of old layout functions

**Files:**
- Modify: `src/stores/projectStore.ts:148-149,187-188`
- Modify: `src/containers/ProjectContainer.tsx:6,37`
- Modify: `src/containers/WorktreeContainer.tsx:14-25,79-80,82-113,115-180,272-316`
- Modify: `src/hooks/useKeyboardShortcuts.ts:1-91`
- Modify: `src/components/Sidebar.tsx` (lines using computeWorktreeSize)
- Modify: `src/toolbar/Toolbar.tsx` (lines using computeWorktreeSize)
- Modify: `src/terminal/TerminalTile.tsx:9,349-350`

This is the largest task. Each file needs to switch from the old API (`computeGridCols`, `computeTerminalPosition`, `TERMINAL_W`/`TERMINAL_H` for sizing) to the new `packTerminals` API.

**Step 1: Update projectStore.ts**

`computeWorktreeSize` now takes `spans[]` instead of `terminalCount`. Update `resolveWorktreeOverlaps` and `getProjectBounds`:

```ts
// resolveWorktreeOverlaps: change
const prevSize = computeWorktreeSize(prev.terminals.length);
const currSize = computeWorktreeSize(curr.terminals.length);
// to:
const prevSize = computeWorktreeSize(prev.terminals.map((t) => t.span));
const currSize = computeWorktreeSize(curr.terminals.map((t) => t.span));

// getProjectBounds: change
const wtSize = computeWorktreeSize(wt.terminals.length);
// to:
const wtSize = computeWorktreeSize(wt.terminals.map((t) => t.span));
```

Remove unused imports (`computeWorktreeSize` signature changed, but import stays; remove any old imports if needed).

**Step 2: Update ProjectContainer.tsx**

Change:
```ts
const wtSize = computeWorktreeSize(wt.terminals.length);
// to:
const wtSize = computeWorktreeSize(wt.terminals.map((t) => t.span));
```

**Step 3: Update Sidebar.tsx**

Same pattern — change all `computeWorktreeSize(wt.terminals.length)` to `computeWorktreeSize(wt.terminals.map((t) => t.span))`.

**Step 4: Update Toolbar.tsx**

Same pattern.

**Step 5: Update TerminalTile.tsx**

Remove `TERMINAL_W, TERMINAL_H` import. Accept `width` and `height` as props instead of using constants:

```ts
// Add to Props interface:
width: number;
height: number;

// In the style, change:
width: TERMINAL_W,
height: terminal.minimized ? "auto" : TERMINAL_H,
// to:
width: width,
height: terminal.minimized ? "auto" : height,
```

**Step 6: Update WorktreeContainer.tsx**

This is the most complex change. Replace `computeGridCols`/`computeTerminalPosition` usage with `packTerminals`:

```ts
import {
  packTerminals,
  computeWorktreeSize,
  WT_PAD,
  WT_TITLE_H,
  TERMINAL_W,
  TERMINAL_H,
  GRID_GAP,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";

// Replace:
// const cols = computeGridCols(terminalCount);
// const computedSize = computeWorktreeSize(terminalCount);
// With:
const spans = worktree.terminals.map((t) => t.span);
const packed = packTerminals(spans);
const computedSize = computeWorktreeSize(spans);

// handleZoomToFit: use packed[index] for position and size
const handleZoomToFit = useCallback(
  (index: number) => {
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
    if (!project) return;
    const currentSpans = project.worktrees
      .find((w) => w.id === worktree.id)
      ?.terminals.map((t) => t.span) ?? [];
    const currentPacked = packTerminals(currentSpans);
    const item = currentPacked[index];
    if (!item) return;

    const absX = project.position.x + PROJ_PAD + worktree.position.x + WT_PAD + item.x;
    const absY = project.position.y + PROJ_TITLE_H + PROJ_PAD + worktree.position.y + WT_TITLE_H + WT_PAD + item.y;

    const padding = 60;
    const viewW = window.innerWidth - padding * 2;
    const viewH = window.innerHeight - padding * 2;
    const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

    const centerX = -(absX + item.w / 2) * scale + window.innerWidth / 2;
    const centerY = -(absY + item.h / 2) * scale + window.innerHeight / 2;

    useCanvasStore.getState().animateTo(centerX, centerY, scale);
  },
  [projectId, worktree.id, worktree.position],
);

// Terminal drag: use packed positions for hit testing
// The drag reorder logic needs to use packed layout for determining target position.
// For simplicity, use the terminal's packed position for origin, and do hit testing
// by finding which packed cell the cursor center falls into.

// Rendering: use packed[index] for each terminal's position and size
{worktree.terminals.map((terminal, index) => {
  const item = packed[index];
  if (!item) return null;
  // ... isDragging logic stays similar but uses item.x, item.y
  return (
    <TerminalTile
      key={terminal.id}
      ...
      gridX={item.x}
      gridY={item.y}
      width={item.w}
      height={item.h}
      ...
    />
  );
})}
```

**Step 7: Update useKeyboardShortcuts.ts**

`zoomToTerminal` needs to use `packTerminals` instead of `computeGridCols`/`computeTerminalPosition`:

```ts
import {
  packTerminals,
  TERMINAL_W,
  TERMINAL_H,
  WT_PAD,
  WT_TITLE_H,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";

function zoomToTerminal(projectId, worktreeId, terminalId) {
  const { projects } = useProjectStore.getState();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  const worktree = project.worktrees.find((w) => w.id === worktreeId);
  if (!worktree) return;
  const terminalIndex = worktree.terminals.findIndex((t) => t.id === terminalId);
  if (terminalIndex === -1) return;

  const packed = packTerminals(worktree.terminals.map((t) => t.span));
  const item = packed[terminalIndex];
  if (!item) return;

  const absX = project.position.x + PROJ_PAD + worktree.position.x + WT_PAD + item.x;
  const absY = project.position.y + PROJ_TITLE_H + PROJ_PAD + worktree.position.y + WT_TITLE_H + WT_PAD + item.y;

  const padding = 60;
  const viewW = window.innerWidth - padding * 2;
  const viewH = window.innerHeight - padding * 2;
  const scale = Math.min(viewW / item.w, viewH / item.h) * 0.85;

  const centerX = -(absX + item.w / 2) * scale + window.innerWidth / 2;
  const centerY = -(absY + item.h / 2) * scale + window.innerHeight / 2;

  useCanvasStore.getState().animateTo(centerX, centerY, scale);
}
```

**Step 8: Commit**

```
git add src/stores/projectStore.ts src/containers/ProjectContainer.tsx src/containers/WorktreeContainer.tsx src/terminal/TerminalTile.tsx src/hooks/useKeyboardShortcuts.ts src/components/Sidebar.tsx src/toolbar/Toolbar.tsx
git commit -m "Migrate all layout callers to bin-packing API"
```

---

### Task 4: Keyboard shortcuts for span switching

**Files:**
- Modify: `src/stores/shortcutStore.ts:3-17`
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/components/ShortcutHints.tsx:11-17`
- Modify: `src/components/SettingsModal.tsx:22-28`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`

**Step 1: Add shortcut entries to ShortcutMap**

In `src/stores/shortcutStore.ts`:

```ts
export interface ShortcutMap {
  toggleSidebar: string;
  newTerminal: string;
  nextTerminal: string;
  prevTerminal: string;
  clearFocus: string;
  spanDefault: string;
  spanWide: string;
  spanTall: string;
  spanLarge: string;
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  toggleSidebar: "mod+b",
  newTerminal: "mod+t",
  nextTerminal: "mod+]",
  prevTerminal: "mod+[",
  clearFocus: "escape",
  spanDefault: "mod+1",
  spanWide: "mod+2",
  spanTall: "mod+3",
  spanLarge: "mod+4",
};
```

**Step 2: Handle shortcuts in useKeyboardShortcuts.ts**

Add after existing shortcut handlers:

```ts
const SPAN_PRESETS: { key: keyof ShortcutMap; span: { cols: number; rows: number } }[] = [
  { key: "spanDefault", span: { cols: 1, rows: 1 } },
  { key: "spanWide", span: { cols: 2, rows: 1 } },
  { key: "spanTall", span: { cols: 1, rows: 2 } },
  { key: "spanLarge", span: { cols: 2, rows: 2 } },
];

for (const preset of SPAN_PRESETS) {
  if (matchesShortcut(e, shortcuts[preset.key])) {
    e.preventDefault();
    const { projects, updateTerminalSpan } = useProjectStore.getState();
    for (const p of projects) {
      for (const w of p.worktrees) {
        const focused = w.terminals.find((t) => t.focused);
        if (focused) {
          updateTerminalSpan(p.id, w.id, focused.id, preset.span);
          return;
        }
      }
    }
    return;
  }
}
```

**Step 3: Add i18n strings**

In `src/i18n/zh.ts` add:
```ts
shortcut_span_default: "默认大小",
shortcut_span_wide: "宽",
shortcut_span_tall: "高",
shortcut_span_large: "大",
```

In `src/i18n/en.ts` add:
```ts
shortcut_span_default: "Default size",
shortcut_span_wide: "Wide",
shortcut_span_tall: "Tall",
shortcut_span_large: "Large",
```

**Step 4: Update ShortcutHints.tsx**

Add the 4 new hints to the `hints` array.

**Step 5: Update SettingsModal.tsx**

Add the 4 new entries to `SHORTCUT_KEYS` array.

**Step 6: Commit**

```
git add src/stores/shortcutStore.ts src/hooks/useKeyboardShortcuts.ts src/i18n/zh.ts src/i18n/en.ts src/components/ShortcutHints.tsx src/components/SettingsModal.tsx
git commit -m "Add keyboard shortcuts for terminal span switching"
```

---

### Task 5: Right-click context menu for span switching

**Files:**
- Create: `src/components/ContextMenu.tsx`
- Modify: `src/terminal/TerminalTile.tsx`

**Step 1: Create ContextMenu component**

Create `src/components/ContextMenu.tsx`:

```tsx
import { useEffect, useRef } from "react";

interface MenuItem {
  label: string;
  active?: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg min-w-[140px]"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={`w-full px-3 py-1.5 text-left text-[12px] transition-colors duration-100 ${
            item.active
              ? "text-[var(--accent)] bg-[var(--accent)]/10"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]"
          }`}
          style={{ fontFamily: '"Geist Mono", monospace' }}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Wire up context menu in TerminalTile title bar**

In `TerminalTile.tsx`, add `onContextMenu` handler to the title bar div. The parent `WorktreeContainer` should manage the context menu state and pass an `onSpanChange` callback. Or TerminalTile can manage it locally.

Approach: TerminalTile manages its own context menu state:

```tsx
// Add state in TerminalTile:
const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

// Add to Props:
onSpanChange?: (span: { cols: number; rows: number }) => void;

// Title bar div gets onContextMenu:
onContextMenu={(e) => {
  e.preventDefault();
  e.stopPropagation();
  setContextMenu({ x: e.clientX, y: e.clientY });
}}

// Render context menu (use createPortal to document.body):
{contextMenu && createPortal(
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={[
      { label: "1×1", active: terminal.span.cols === 1 && terminal.span.rows === 1, onClick: () => onSpanChange?.({ cols: 1, rows: 1 }) },
      { label: "2×1 Wide", active: terminal.span.cols === 2 && terminal.span.rows === 1, onClick: () => onSpanChange?.({ cols: 2, rows: 1 }) },
      { label: "1×2 Tall", active: terminal.span.cols === 1 && terminal.span.rows === 2, onClick: () => onSpanChange?.({ cols: 1, rows: 2 }) },
      { label: "2×2 Large", active: terminal.span.cols === 2 && terminal.span.rows === 2, onClick: () => onSpanChange?.({ cols: 2, rows: 2 }) },
    ]}
    onClose={() => setContextMenu(null)}
  />,
  document.body,
)}
```

WorktreeContainer passes `onSpanChange`:
```tsx
onSpanChange={(span) => updateTerminalSpan(projectId, worktree.id, terminal.id, span)}
```

**Step 3: Commit**

```
git add src/components/ContextMenu.tsx src/terminal/TerminalTile.tsx src/containers/WorktreeContainer.tsx
git commit -m "Add right-click context menu for terminal span switching"
```

---

### Task 6: Build verification

**Step 1: Run build**

```
npm run build
```

Fix any TypeScript errors.

**Step 2: Manual smoke test**

- Open the app
- Add a project
- Create terminals of different types
- Verify AI terminals default to 2×1
- Right-click → change span → verify layout reflows
- Use Mod+1/2/3/4 → verify span changes
- Collapse/expand worktree → verify no clipping
- Close and reopen → verify span persists

**Step 3: Final commit if any fixes needed**
