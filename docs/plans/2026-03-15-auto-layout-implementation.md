# Auto Layout Containers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove manual resize from all containers and terminals. Containers auto-fit children. Terminals live in a uniform grid. Drag-to-reorder within grid. Double-click zoom-to-fit.

**Architecture:** Bottom-up computed sizing. Terminal array index = grid position. Layout constants centralized. Store simplified (remove size/position update actions). Backward-compatible state loading (extra fields ignored).

**Tech Stack:** React, Zustand, TypeScript, xterm.js

---

### Task 1: Add layout constants

**Files:**
- Create: `src/layout.ts`

**Step 1: Create layout constants file**

```typescript
// src/layout.ts
export const TERMINAL_W = 540;
export const TERMINAL_H = 260;
export const GRID_GAP = 8;

export const WT_PAD = 10;
export const WT_TITLE_H = 36;

export const PROJ_PAD = 12;
export const PROJ_TITLE_H = 40;

export function computeGridCols(terminalCount: number): number {
  if (terminalCount <= 0) return 1;
  const aspect = window.innerWidth / window.innerHeight;
  return Math.max(1, Math.round(Math.sqrt(terminalCount * aspect)));
}

export function computeWorktreeSize(terminalCount: number): { w: number; h: number } {
  if (terminalCount === 0) return { w: 300, h: WT_TITLE_H + WT_PAD + 60 + WT_PAD };
  const cols = computeGridCols(terminalCount);
  const rows = Math.ceil(terminalCount / cols);
  const w = cols * TERMINAL_W + (cols - 1) * GRID_GAP + WT_PAD * 2;
  const h = WT_TITLE_H + WT_PAD + rows * TERMINAL_H + (rows - 1) * GRID_GAP + WT_PAD;
  return { w, h };
}

export function computeTerminalPosition(index: number, cols: number): { x: number; y: number } {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: col * (TERMINAL_W + GRID_GAP),
    y: row * (TERMINAL_H + GRID_GAP),
  };
}
```

**Step 2: Verify**

Run: `npm run typecheck`

**Step 3: Commit**

```
feat: add centralized layout constants and grid computation helpers
```

---

### Task 2: Refactor TerminalTile — remove resize, use grid position from props

**Files:**
- Modify: `src/terminal/TerminalTile.tsx`

**What changes:**
- Remove `useResize` import and usage (lines 9, 89-114)
- Remove resize handle JSX (lines 411-430)
- Remove free-drag `useDrag` — replaced by a `gridPosition` prop from parent
- Remove `worktreeSize` prop (no longer needed for clamping)
- Add `gridX`, `gridY` props for computed position
- Keep title bar drag handler for now (will become reorder drag in Task 6)
- Position via `gridX`/`gridY` props instead of `terminal.position`
- Size via imported constants instead of `terminal.size`
- Add `onDoubleClick` handler on title bar (placeholder for zoom-to-fit in Task 7)

**Key changes to Props:**

```typescript
interface Props {
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  terminal: TerminalData;
  gridX: number;
  gridY: number;
}
```

**Key changes to render:**

```typescript
style={{
  left: gridX,
  top: gridY,
  width: TERMINAL_W,
  height: terminal.minimized ? "auto" : TERMINAL_H,
}}
```

- Remove all `wtAvailW`, `wtAvailH`, `tW`, `tH` clamping calculations
- Remove `handleResize` and its resize handle div
- Keep `handleDrag` for now but make it a no-op (remove the `useDrag` call and the `onMouseDown={handleDrag}` — will be replaced by grid reorder later). Actually, remove `useDrag` entirely from TerminalTile; the title bar `onMouseDown` will be used for reorder in Task 6.

**Step 1: Apply changes**

Edit TerminalTile.tsx per above.

**Step 2: Verify**

Run: `npm run typecheck`
Note: Will have errors in WorktreeContainer.tsx because it still passes old props. Fix in next task.

**Step 3: Commit**

```
refactor: remove resize and free drag from TerminalTile
```

---

### Task 3: Refactor WorktreeContainer — compute size, remove resize, pass grid positions

**Files:**
- Modify: `src/containers/WorktreeContainer.tsx`

**What changes:**
- Remove `useResize` import and usage
- Remove resize handle JSX (lines 278-296)
- Remove `contentMinH`, `childMinW`, `childMinH` calculations
- Remove `updateWorktreeSize` from store destructure
- Replace `handleNewTerminal` with simplified version (just creates terminal and adds it)
- Compute worktree size via `computeWorktreeSize(worktree.terminals.length)`
- Compute each terminal's grid position via `computeTerminalPosition(index, cols)`
- Pass `gridX`, `gridY` to TerminalTile instead of relying on `terminal.position`
- Use computed width for style and DiffCard anchor

**Simplified `handleNewTerminal`:**

```typescript
const handleNewTerminal = useCallback(() => {
  const terminal = createTerminal("shell");
  addTerminal(projectId, worktree.id, terminal);
}, [projectId, worktree.id, addTerminal]);
```

**Computed size and rendering:**

```typescript
const terminalCount = worktree.terminals.length;
const cols = computeGridCols(terminalCount);
const { w: computedW, h: computedH } = computeWorktreeSize(terminalCount);

// In JSX:
style={{
  left: worktree.position.x,
  top: worktree.position.y,
  width: computedW,
  height: worktree.collapsed ? undefined : computedH,
  minWidth: 300,
}}

// Terminal rendering:
{worktree.terminals.map((terminal, index) => {
  const { x, y } = computeTerminalPosition(index, cols);
  return (
    <TerminalTile
      key={terminal.id}
      projectId={projectId}
      worktreeId={worktree.id}
      worktreePath={worktree.path}
      terminal={terminal}
      gridX={x}
      gridY={y}
    />
  );
})}
```

**Content area:**

```typescript
// Replace minHeight: contentMinH with computed value
const contentH = computedH - WT_TITLE_H - WT_PAD;
// style={{ minHeight: contentH }}
```

**DiffCard anchor:** Use `computedW` instead of `worktree.size.w`.

**Step 1: Apply changes**

Edit WorktreeContainer.tsx per above.

**Step 2: Verify**

Run: `npm run typecheck`

**Step 3: Commit**

```
refactor: WorktreeContainer auto-computes size from terminal grid
```

---

### Task 4: Refactor ProjectContainer — compute size, remove resize

**Files:**
- Modify: `src/containers/ProjectContainer.tsx`

**What changes:**
- Remove `useResize` import and usage
- Remove resize handle JSX (lines 147-165)
- Remove `childMinW`, `childMinH` calculations
- Remove `updateProjectSize` from store destructure
- Compute project size from worktree computed sizes
- Remove `parentSize` prop from WorktreeContainer (no longer needed)

**Computed project size:**

```typescript
import { computeWorktreeSize, PROJ_PAD, PROJ_TITLE_H } from "../layout";

const computedSize = useMemo(() => {
  if (project.worktrees.length === 0) return { w: 340, h: PROJ_TITLE_H + PROJ_PAD + 60 + PROJ_PAD };
  let maxW = 300;
  let totalH = 0;
  for (const wt of project.worktrees) {
    const wtSize = computeWorktreeSize(wt.terminals.length);
    maxW = Math.max(maxW, wt.position.x + wtSize.w);
    totalH = Math.max(totalH, wt.position.y + wtSize.h);
  }
  return {
    w: maxW + PROJ_PAD * 2,
    h: PROJ_TITLE_H + PROJ_PAD + totalH + PROJ_PAD,
  };
}, [project.worktrees]);
```

**In JSX:**

```typescript
style={{
  left: project.position.x,
  top: project.position.y,
  width: project.collapsed ? 340 : computedSize.w,
  height: project.collapsed ? undefined : computedSize.h,
  minWidth: 340,
  zIndex: project.zIndex ?? 0,
}}
```

**Remove `parentSize` prop from WorktreeContainer:** also remove it from WorktreeContainer's Props interface.

**Step 1: Apply changes**

Edit ProjectContainer.tsx, then update WorktreeContainer.tsx Props to remove `parentSize`.

**Step 2: Verify**

Run: `npm run typecheck`

**Step 3: Commit**

```
refactor: ProjectContainer auto-computes size from worktree layout
```

---

### Task 5: Update Sidebar focus and clean up store

**Files:**
- Modify: `src/components/Sidebar.tsx` (lines 90-112)
- Modify: `src/stores/projectStore.ts`

**Sidebar — use computed sizes for focus:**

```typescript
import { computeWorktreeSize, PROJ_PAD, PROJ_TITLE_H } from "../layout";

const handleFocus = useCallback(
  (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    // Compute project size the same way ProjectContainer does
    let maxW = 300;
    let totalH = 0;
    for (const wt of project.worktrees) {
      const wtSize = computeWorktreeSize(wt.terminals.length);
      maxW = Math.max(maxW, wt.position.x + wtSize.w);
      totalH = Math.max(totalH, wt.position.y + wtSize.h);
    }
    const projW = Math.max(340, maxW + PROJ_PAD * 2);
    const projH = PROJ_TITLE_H + PROJ_PAD + totalH + PROJ_PAD;

    const padding = 80;
    const toolbarH = 44;
    const viewW = window.innerWidth - padding * 2;
    const viewH = window.innerHeight - toolbarH - padding * 2;
    const scale = Math.min(1, viewW / projW, viewH / projH);

    const centerX = -(project.position.x + projW / 2) * scale + window.innerWidth / 2;
    const centerY = -(project.position.y + projH / 2) * scale + (window.innerHeight + toolbarH) / 2;

    animateTo(centerX, centerY, scale);
  },
  [projects, animateTo],
);
```

**Store cleanup — remove unused actions:**

From `projectStore.ts`, remove:
- `updateWorktreeSize` action and its interface entry
- `updateProjectSize` action and its interface entry
- `updateTerminalSize` action and its interface entry
- `updateTerminalPosition` action and its interface entry

Keep `updateWorktreePosition` (worktrees can still be dragged within projects).

**Step 1: Apply Sidebar changes**

**Step 2: Apply store cleanup**

**Step 3: Verify**

Run: `npm run typecheck`

**Step 4: Commit**

```
refactor: update Sidebar focus to use computed sizes, remove unused store actions
```

---

### Task 6: Clean up types and delete useResize

**Files:**
- Modify: `src/types/index.ts`
- Delete: `src/hooks/useResize.ts`
- Modify: `src/stores/projectStore.ts` — update `createTerminal`, `syncWorktrees`

**Type changes:**

```typescript
// TerminalData: remove position, size
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
}

// WorktreeData: remove size
export interface WorktreeData {
  id: string;
  name: string;
  path: string;
  position: Position;
  collapsed: boolean;
  terminals: TerminalData[];
}

// ProjectData: remove size
export interface ProjectData {
  id: string;
  name: string;
  path: string;
  position: Position;
  collapsed: boolean;
  zIndex: number;
  worktrees: WorktreeData[];
}
```

**Store `createTerminal`:**

```typescript
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
  };
}
```

**Store `syncWorktrees`:** Remove `size` from new worktree creation:

```typescript
return {
  id: generateId(),
  name: wt.branch,
  path: wt.path,
  position: { x: 0, y: 0 },
  collapsed: false,
  terminals: [],
};
```

**Delete `src/hooks/useResize.ts`** — no longer imported anywhere.

**Step 1: Apply type changes**

**Step 2: Fix all resulting TypeScript errors** (mostly removing references to `.size` and `.position` on terminals)

**Step 3: Delete useResize.ts**

**Step 4: Verify**

Run: `npm run typecheck`

**Step 5: Commit**

```
refactor: remove size/position from data model, delete useResize hook
```

---

### Task 7: Add reorderTerminal store action

**Files:**
- Modify: `src/stores/projectStore.ts`

**Add to interface and implementation:**

```typescript
// Interface
reorderTerminal: (
  projectId: string,
  worktreeId: string,
  terminalId: string,
  newIndex: number,
) => void;

// Implementation
reorderTerminal: (projectId, worktreeId, terminalId, newIndex) =>
  set((state) => ({
    projects: state.projects.map((p) =>
      p.id !== projectId
        ? p
        : {
            ...p,
            worktrees: p.worktrees.map((w) => {
              if (w.id !== worktreeId) return w;
              const terminals = [...w.terminals];
              const oldIndex = terminals.findIndex((t) => t.id === terminalId);
              if (oldIndex === -1 || oldIndex === newIndex) return w;
              const [moved] = terminals.splice(oldIndex, 1);
              terminals.splice(newIndex, 0, moved);
              return { ...w, terminals };
            }),
          },
    ),
  })),
```

**Step 1: Apply changes**

**Step 2: Verify**

Run: `npm run typecheck`

**Step 3: Commit**

```
feat: add reorderTerminal store action
```

---

### Task 8: Add drag-to-reorder UI

**Files:**
- Modify: `src/containers/WorktreeContainer.tsx`
- Modify: `src/terminal/TerminalTile.tsx`

**Approach:** Use local state in WorktreeContainer to track drag state. TerminalTile gets an `onDragStart` prop. During drag, a ghost placeholder shows in the original position and the dragged terminal follows the cursor. On hover over other grid cells, compute target index and preview the swap.

**WorktreeContainer additions:**

```typescript
const [dragState, setDragState] = useState<{
  terminalId: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  currentIndex: number;
} | null>(null);

const { reorderTerminal } = useProjectStore();

const handleTerminalDragStart = useCallback(
  (terminalId: string, e: React.MouseEvent) => {
    const index = worktree.terminals.findIndex((t) => t.id === terminalId);
    if (index === -1) return;
    e.preventDefault();
    e.stopPropagation();
    const scale = useCanvasStore.getState().viewport.scale;

    const state = {
      terminalId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: 0,
      offsetY: 0,
      currentIndex: index,
    };
    setDragState(state);

    const handleMove = (ev: MouseEvent) => {
      const ox = (ev.clientX - state.startX) / scale;
      const oy = (ev.clientY - state.startY) / scale;
      // Compute which grid cell the cursor is over
      const cx = computeTerminalPosition(state.currentIndex, cols).x + ox + TERMINAL_W / 2;
      const cy = computeTerminalPosition(state.currentIndex, cols).y + oy + TERMINAL_H / 2;
      const col = Math.max(0, Math.min(cols - 1, Math.floor(cx / (TERMINAL_W + GRID_GAP))));
      const row = Math.max(0, Math.floor(cy / (TERMINAL_H + GRID_GAP)));
      const targetIndex = Math.min(worktree.terminals.length - 1, row * cols + col);

      setDragState((prev) => prev ? { ...prev, offsetX: ox, offsetY: oy, currentIndex: targetIndex } : null);
    };

    const handleUp = () => {
      setDragState((prev) => {
        if (prev) reorderTerminal(projectId, worktree.id, prev.terminalId, prev.currentIndex);
        return null;
      });
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  },
  [projectId, worktree.id, worktree.terminals, cols, reorderTerminal],
);
```

**TerminalTile additions:**

- Add `onDragStart: (terminalId: string, e: React.MouseEvent) => void` prop
- Add `isDragging: boolean` prop
- Add `dragOffsetX: number` and `dragOffsetY: number` props
- Title bar `onMouseDown` calls `onDragStart(terminal.id, e)`
- When `isDragging`, add offset to position and visual feedback (opacity, shadow, z-index)

**Step 1: Implement drag state in WorktreeContainer**

**Step 2: Add drag props to TerminalTile**

**Step 3: Verify**

Run: `npm run typecheck`
Manual test: drag terminal, verify grid reorder works

**Step 4: Commit**

```
feat: add drag-to-reorder terminals within grid
```

---

### Task 9: Add double-click zoom-to-fit

**Files:**
- Modify: `src/terminal/TerminalTile.tsx`
- Modify: `src/containers/WorktreeContainer.tsx`

**Approach:** Double-click on terminal title bar → compute absolute position of terminal on canvas → `animateTo` that centers and zooms it.

**WorktreeContainer passes absolute offset:**

TerminalTile needs to know its absolute canvas position. Pass `canvasOffsetX` and `canvasOffsetY` props (sum of project position + worktree position + content padding).

Actually simpler: pass a callback `onZoomToFit(terminalId)` from WorktreeContainer, which computes the absolute position and calls `animateTo`.

**WorktreeContainer:**

```typescript
const handleZoomToFit = useCallback(
  (index: number) => {
    // Get project position
    const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    const { x: gridX, y: gridY } = computeTerminalPosition(index, cols);
    // Absolute position: project.position + worktree.position + content padding + grid position
    const absX = project.position.x + PROJ_PAD + worktree.position.x + WT_PAD + gridX;
    const absY = project.position.y + PROJ_TITLE_H + PROJ_PAD + worktree.position.y + WT_TITLE_H + WT_PAD + gridY;

    const padding = 60;
    const viewW = window.innerWidth - padding * 2;
    const viewH = window.innerHeight - padding * 2;
    const scale = Math.min(viewW / TERMINAL_W, viewH / TERMINAL_H) * 0.85;

    const centerX = -(absX + TERMINAL_W / 2) * scale + window.innerWidth / 2;
    const centerY = -(absY + TERMINAL_H / 2) * scale + window.innerHeight / 2;

    useCanvasStore.getState().animateTo(centerX, centerY, scale);
  },
  [projectId, worktree.position, cols],
);
```

**TerminalTile:** Add `onDoubleClick` prop, fire on title bar double-click.

**Step 1: Apply changes**

**Step 2: Verify**

Run: `npm run typecheck`
Manual test: double-click terminal, verify zoom animation

**Step 3: Commit**

```
feat: double-click terminal to zoom-to-fit
```

---

### Task 10: State persistence backward compatibility

**Files:**
- Modify: `src/App.tsx`

**What changes:**

When loading old saved state, terminals may have `position` and `size` fields, and worktrees/projects may have `size` fields. Since these fields are no longer in the TypeScript types, they'll just be extra properties on the JS objects — harmless but messy.

Add a migration in `restoreFromData` to strip old fields:

```typescript
function migrateProjects(projects: unknown[]): ProjectData[] {
  return projects.map((p: any) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    position: p.position,
    collapsed: p.collapsed ?? false,
    zIndex: p.zIndex ?? 0,
    worktrees: (p.worktrees ?? []).map((wt: any) => ({
      id: wt.id,
      name: wt.name,
      path: wt.path,
      position: wt.position ?? { x: 0, y: 0 },
      collapsed: wt.collapsed ?? false,
      terminals: (wt.terminals ?? []).map((t: any) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        minimized: t.minimized ?? false,
        focused: t.focused ?? false,
        ptyId: null,
        status: t.status ?? "idle",
        scrollback: t.scrollback,
        sessionId: t.sessionId,
      })),
    })),
  }));
}
```

Use in `restoreFromData`:

```typescript
if (data.projects && Array.isArray(data.projects)) {
  useProjectStore.getState().setProjects(migrateProjects(data.projects));
}
```

**Step 1: Apply changes**

**Step 2: Verify**

Run: `npm run typecheck`

**Step 3: Commit**

```
fix: migrate persisted state to strip removed size/position fields
```
