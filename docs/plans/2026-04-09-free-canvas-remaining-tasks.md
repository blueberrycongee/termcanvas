# Free Canvas — Remaining Tasks Handoff

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement these tasks.

## Original Design Vision

Issue #122 requested drag-to-resize + configurable columns. We chose a broader direction:

**Free-form canvas + rule-based clustering**, replacing the nested Project → Worktree → 3-column grid layout with:

1. Every terminal is a **flat top-level ReactFlow node** with its own `x, y, width, height`
2. Project/worktree are **invisible on canvas** — pure metadata containers
3. Terminals carry **tags** (`project:X`, `worktree:X`, `type:X`, `status:X`, `custom:X`)
4. **One-click clustering** rearranges tiles by tag dimension (action, not mode), with undo
5. **Loose grid snap** (10px) for positioning, **edge-drag resize** with NodeResizer
6. **Collision resolution** pushes overlapping tiles apart on drag/resize end

Full design: `docs/plans/2026-04-09-free-canvas-design.md`
Full plan: `docs/plans/2026-04-09-free-canvas-plan.md`

---

## Completed (Tasks 1-6)

All on `main` branch. `tsc --noEmit` passes. 31 tests pass.

### Task 1: Type Definitions (`405fc834`)
- `src/types/index.ts` — TerminalData: added `x, y, width, height, tags`; removed `span`
- ProjectData: removed `position, collapsed, zIndex, autoCompact`
- WorktreeData: removed `position, collapsed`

### Task 2: Clustering Engine (`55104212`)
- **New file**: `src/clustering.ts`
- `packGroup()` — compact grid layout within a cluster
- `clusterByTag(tiles, tagPrefix)` — groups tiles by tag, arranges groups with 60px inter-group gap
- `cluster(tiles, rule)` — convenience wrapper for built-in rules
- **Test**: `tests/clustering.test.ts` (4 tests)

### Task 3: Collision Resolution (`c5211706`)
- **New file**: `src/canvas/collisionResolver.ts`
- `resolveCollisions(rects, gap, anchorId?)` — minimum-translation-vector push, optional anchor
- **Test**: `tests/collision-resolver.test.ts` (3 tests)

### Task 4: Data Migration (`d0296582`)
- **New file**: `src/migration/migrateToFreeCanvas.ts`
- Converts `span` → `width/height`, generates auto-tags, runs initial cluster-by-project
- Removes `position/collapsed/zIndex` from project/worktree
- Sets `schemaVersion: 2`
- **Test**: `tests/free-canvas-migration.test.ts` (3 tests)

### Task 5: projectStore Refactor (`3d8a0d93`)
- Removed 6 store methods: `updateProjectPosition`, `toggleProjectCollapse`, `compactProjectWorktrees`, `bringToFront`, `updateWorktreePosition`, `toggleWorktreeCollapse`, `updateTerminalSpan`
- Removed 5 internal functions: `resolveOverlaps`, `resolveWorktreeOverlaps`, `compactWorktreeLayout`, `getProjectBounds`, `rectsOverlap`
- Added 4 new methods: `updateTerminalPosition`, `updateTerminalSize`, `addTerminalTag`, `removeTerminalTag`
- `createTerminal()` now returns `x/y/width/height/tags` instead of `span`
- `addTerminal()` auto-generates tags
- Updated `projectFocus.ts`, `projectCreation.ts`, 4 test files

### Task 6: Canvas Node Flattening (`6673d9c1` + `31798913` + `b19a4a09`)
- **Rewrote** `src/canvas/xyflowNodes.tsx` — replaced `ProjectNode` + `WorktreeNode` (~933 lines) with single `TerminalNode` (180 lines) using `NodeResizer`
- **Rewrote** `src/canvas/nodeProjection.ts` — `buildCanvasFlowNodes()` now emits one node per terminal
- **Rewrote** `src/canvas/XyFlowCanvas.tsx` — added `snapToGrid`, `snapGrid=[10,10]`, flat `TerminalRuntimeLayer`, collision on drag-stop
- **Simplified** `src/utils/panToTerminal.ts` (220→104 lines) — uses `terminal.x/y` directly
- **Simplified** `src/hooks/useBoxSelect.ts` — flat iteration over terminals
- **Simplified** `src/components/FamilyTreeOverlay.tsx` — uses terminal coords directly
- Updated 18 files total, net -844 lines
- Fixed ALL type errors across the entire codebase (tsc --noEmit = 0 errors)

---

## Remaining Tasks (7-13)

### Task 7: Clustering UI + Undo

**Goal**: User-facing UI to trigger clustering and undo.

**Files to create:**
- `src/stores/clusterStore.ts` — Zustand store:
  - `lastRule: ClusterRule | null`
  - `positionSnapshot: Record<string, {x, y, width, height}> | null`
  - `applyCluster(rule)` — snapshot current positions, run `cluster()` from `src/clustering.ts`, write new positions via `updateTerminalPosition`
  - `undoCluster()` — restore snapshot
  - `canUndo: boolean`
- `src/canvas/ClusterToolbar.tsx` — dropdown with 5 rules (By Project / Worktree / Type / Status / Custom Tag) + undo button
- Wire `ClusterToolbar` into `XyFlowCanvas.tsx`

**Test**: `tests/cluster-store.test.ts`

### Task 8: Terminal Creation — Canvas + Session Panel

**Goal**: Two entry points for creating terminals.

**Canvas right-click:**
- In `XyFlowCanvas.tsx`, handle `onPaneContextMenu`
- Show menu: New Terminal → project → worktree → type
- Create at click position (use `screenToFlowPosition`), snap to 10px
- Run `resolveCollisions()` after

**Session panel right-click:**
- In the session panel worktree node context menu
- "New Terminal" → type submenu
- Position: near same-worktree tiles, or viewport center if none

**Agent spawn:**
- When `parentTerminalId` set, place adjacent to parent tile (right/below, 8px gap)

### Task 9: Tag Management UI

**Goal**: UI for managing custom tags on terminals.

**Files to create:**
- `src/terminal/TagManager.tsx` — popover component:
  - Auto-tags (read-only, grayed): `project:X`, `worktree:X`, `type:X`
  - Custom tags (editable): `custom:*` with delete
  - Input to add new custom tag
- Wire into `TerminalTile.tsx` context menu → "Tags..."
- Drag-to-group: drag terminal A onto B → "Create Group" dialog → both get `custom:<name>` tag

**Store methods already exist**: `addTerminalTag`, `removeTerminalTag` in projectStore.

### Task 10: Stash + Minimize Adaptations

**Goal**: Adapt stash and minimize for flat canvas.

- `stashTerminal()`: already keeps `x, y, width, height` — verify it works
- `unstashTerminal()`: check if original `(x, y)` is free; if collision, move to viewport center; run `resolveCollisions()`
- Minimize: tile keeps `x, y, width` but renders at header-only height. Stored `height` is full height for un-minimize.

### Task 11: Persistence + Migration Hook

**Goal**: Auto-migrate v1 data on startup.

- Update `src/canvas/scenePersistence.ts` — `toPersistedProjectData()` / `restorePersistedProjectData()` for new types
- Add `schemaVersion` check on state load:
  - If missing or `< 2`, run `migrateToFreeCanvas()` from `src/migration/migrateToFreeCanvas.ts`
  - Write `schemaVersion: 2`
- Update `src/snapshotState.ts` if needed

**Test**: `tests/project-store-persistence.test.ts`, `tests/snapshot-state.test.ts`, `tests/state-persistence.test.ts`

### Task 12: Cleanup Dead Code

**Goal**: Remove unused code from pre-refactor.

- `src/layout.ts` — remove `packTerminals`, `computeWorktreeSize`, `getWorktreeSize`, `getStandardWorktreeWidth` if unused. Keep constants only if clustering or migration still imports them.
- `src/canvas/sceneState.ts` — verify removed exports are truly gone
- `src/stores/tileDimensionsStore.ts` — check if still needed (tile dims may only be used for migration default values now)
- Grep for any remaining references to removed functions/types
- Run `tsc --noEmit && npm test` to confirm nothing breaks

### Task 13: Integration Test

**Goal**: End-to-end test verifying the complete flow.

Create `tests/free-canvas-integration.test.ts`:
1. Create project with 2 worktrees, each with 2 terminals
2. Verify terminals have `x, y, width, height, tags`
3. Run `cluster("by-project")` → verify same-project tiles grouped
4. Run `cluster("by-type")` → verify same-type tiles grouped
5. Simulate drag (update position) → verify collision resolution
6. Stash terminal → verify hidden → unstash → verify position restored

Run full suite: `tsc --noEmit && npm test`

---

## Current Codebase State

- **Branch**: `main` (all work merged)
- **tsc --noEmit**: 0 errors
- **Tests**: 31 passing (clustering, collision, migration, types, project-store)
- **New files**: `src/clustering.ts`, `src/canvas/collisionResolver.ts`, `src/migration/migrateToFreeCanvas.ts`
- **Major rewrites**: `xyflowNodes.tsx` (933→180 lines), `XyFlowCanvas.tsx`, `nodeProjection.ts`, `projectStore.ts`, `panToTerminal.ts`
- **Key architectural change**: ReactFlow nodes are now flat (1 node per terminal, no project/worktree containers)
