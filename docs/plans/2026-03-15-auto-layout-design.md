# Auto Layout Containers Design

## Problem

Users should not manually manage container sizes. Containers (ProjectContainer, WorktreeContainer) should be passive shells that auto-fit their children, like Figma's Auto Layout.

## Design

### Core Principle

Container size = f(children). Size flows bottom-up:

```
Uniform terminal size → Grid(cols, rows) → WorktreeContainer size → ProjectContainer size
```

### What Changes

**Remove:**
- Resize handles and `useResize` calls from ProjectContainer, WorktreeContainer, and TerminalTile
- Free absolute positioning of terminals (replaced by grid index)
- `size.w` / `size.h` as stored state on WorktreeData and ProjectData (becomes computed)
- `updateWorktreeSize`, `updateProjectSize`, `updateTerminalSize`, `updateTerminalPosition` store actions
- Terminal drag clamping to worktree bounds
- `contentMinH`, `childMinW`, `childMinH` calculations

**Add:**
- Grid-based terminal ordering (index in array = grid position)
- Drag-to-reorder within grid (drag terminal, snap to grid cell, swap/shift others)
- Double-click terminal → canvas `animateTo` zoom-to-fit
- Computed container sizes via `useMemo` derived from terminal count and uniform size

### Data Model Changes

```typescript
// TerminalData: remove position, size
interface TerminalData {
  id: string;
  title: string;
  type: TerminalType;
  // position: Position;  // REMOVED - determined by grid index
  // size: Size;          // REMOVED - uniform, derived from constants
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
  status: TerminalStatus;
  scrollback?: string;
  sessionId?: string;
}

// WorktreeData: remove size
interface WorktreeData {
  id: string;
  name: string;
  path: string;
  position: Position;   // KEEP - position within project
  // size: Size;         // REMOVED - computed from grid
  collapsed: boolean;
  terminals: TerminalData[];  // order = grid order
}

// ProjectData: remove size
interface ProjectData {
  id: string;
  name: string;
  path: string;
  position: Position;   // KEEP - position on canvas
  // size: Size;         // REMOVED - computed from worktrees
  collapsed: boolean;
  zIndex: number;
  worktrees: WorktreeData[];
}
```

### Size Computation

Constants:
- `TERMINAL_W = 540`, `TERMINAL_H = 260`
- `GRID_GAP = 8`
- `WT_PAD = 10`, `WT_TITLE_H = 36`
- `PROJ_PAD = 12`, `PROJ_TITLE_H = 40`

WorktreeContainer size:
```
cols = Math.round(Math.sqrt(terminalCount * aspectRatio))
rows = Math.ceil(terminalCount / cols)
wtW = cols * TERMINAL_W + (cols - 1) * GRID_GAP + WT_PAD * 2
wtH = WT_TITLE_H + WT_PAD + rows * TERMINAL_H + (rows - 1) * GRID_GAP + WT_PAD
```

ProjectContainer size:
```
projW = max(worktree widths + positions) + PROJ_PAD * 2
projH = PROJ_TITLE_H + PROJ_PAD + sum(worktree heights) + gaps + PROJ_PAD
```

### Grid Drag-to-Reorder

1. Mouse down on terminal title bar → "lift" terminal (visual: slight scale up, shadow)
2. Mouse move → terminal follows cursor, ghost placeholder remains in grid
3. Hover over another grid cell → other terminals shift/swap to make room
4. Mouse up → terminal snaps to target grid position, array order updated in store

Store action: `reorderTerminal(projectId, worktreeId, terminalId, newIndex)`

### Focus (Zoom-to-Fit)

Double-click terminal → compute viewport transform to center terminal in screen:
```
targetScale = Math.min(screenW / termW, screenH / termH) * 0.85
targetX = -(termAbsX + termW/2) * targetScale + screenW/2
targetY = -(termAbsY + termH/2) * targetScale + screenH/2
canvasStore.animateTo(targetX, targetY, targetScale)
```

Uses existing `animateTo` with easeOutCubic.

### DiffCard Anchor

DiffCard currently anchors to `worktree.size.w`. With computed sizes, anchor to the computed width instead (passed as prop or computed in component).
