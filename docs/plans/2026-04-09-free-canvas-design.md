# Free Canvas + Rule-Based Clustering Design

**Issue**: #122  
**Date**: 2026-04-09  
**Status**: Approved

## Summary

Replace the current Project → Worktree → Grid nesting layout with a flat free-form canvas where every terminal tile is a top-level ReactFlow node. Grouping becomes metadata-driven: tiles carry tags, and one-click clustering rules rearrange tiles by tag dimension.

## Architecture Decision

**Approach A: Keep ReactFlow, flatten nodes.** Remove ProjectNode and WorktreeNode wrappers. Each TerminalTile becomes a direct ReactFlow node. This preserves viewport management, pan/zoom, selection, and snap-to-grid from xyflow while removing the container hierarchy.

## Data Model

### TerminalData Changes

```typescript
interface TerminalData {
  // existing fields retained ...

  // NEW: canvas coordinates (pixel, snapped to 10px grid)
  x: number;
  y: number;

  // NEW: pixel dimensions (replaces span: {cols, rows})
  width: number;
  height: number;

  // NEW: grouping tags (auto + manual)
  tags: string[];
  // Auto-generated: "project:<name>", "worktree:<name>", "type:<type>", "status:<status>"
  // User-added: "custom:<name>"

  // REMOVED: span: { cols: number; rows: number }
}
```

### ProjectData / WorktreeData Changes

These types become pure metadata containers:

- **Removed**: `position`, `collapsed`, `zIndex` (ProjectData)
- **Removed**: `position`, `collapsed` (WorktreeData)
- **Retained**: `id`, `name`, `path`, `terminals[]` (ownership structure for cwd, tag derivation)

## Canvas & Node Structure

### Before (3-layer nesting)

```
ReactFlow Node (ProjectNode)
  └─ div (WorktreeNode)
       └─ div (TerminalTile, absolute positioned by bin-packing)
```

### After (flat)

```
ReactFlow Node (TerminalNode) ← one per terminal, top-level
```

### ReactFlow Configuration

- `snapToGrid: true`, `snapGrid: [10, 10]`
- Single node type: `{ terminal: TerminalNode }`
- `NodeResizer` for edge/corner drag resize, results snap to 10px

### TerminalNode Layout

```
┌─ NodeResizer handles (4 edges + 4 corners) ──────────────┐
│  ┌─ Header ─────────────────────────────────────────────┐ │
│  │  [project badge]  Terminal Title        [controls]   │ │
│  └──────────────────────────────────────────────────────┘ │
│  ┌─ Body ───────────────────────────────────────────────┐ │
│  │                   xterm instance                     │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

- **Project badge**: small color chip + abbreviation in tile header (replaces container visual belonging)
- **Min size**: 320px wide, 200px tall
- **No max size**

### Collision Resolution

On drag-end or resize-end, run `resolveOverlaps()`:

1. Check all node pairs for rect overlap (with 8px min gap)
2. Push overlapping node via minimum translation vector (smallest overlap axis)
3. Loop until no collisions or iteration limit reached
4. Reuse/adapt existing logic from `projectStore.ts`

### Viewport

- `XyFlowCanvas` viewport (pan/zoom) unchanged
- `viewportBounds.ts` culling: check each terminal rect directly (no project bounds indirection)
- `panToTerminal.ts` simplified: use node `(x, y, width, height)` directly

## Clustering Engine

### Core Model

Clustering is a **pure function**, not a mode:

```
clusterByRule(tiles[], rule) → Map<tileId, {x, y}>
```

Triggered by user action (toolbar dropdown or shortcut). Animates tiles to new positions.

### Built-in Rules

| Rule | Groups by | Notes |
|------|-----------|-------|
| `by-project` | `project:<name>` tag | **Default** |
| `by-worktree` | `worktree:<name>` tag | Finer granularity |
| `by-type` | `type:<shell\|claude\|...>` tag | All claude sessions together |
| `by-status` | `status:<running\|idle\|done>` tag | By runtime state |
| `by-custom` | `custom:<name>` tag | User-defined groups |

### Layout Algorithm

**Within group**: Bin-packing with actual pixel dimensions (adapt existing `packTerminals`). 8px gap.

**Between groups**: 60px gap. Groups arranged left-to-right, top-to-bottom. Temporary semi-transparent label above each group (fade out after 2-3s).

### Undo

- Before clustering, snapshot all positions: `Map<tileId, {x, y, width, height}>`
- Undo = restore snapshot with animation
- **Single-level** undo only (last cluster action)

### Custom Tags

- Right-click terminal → Tags → add/remove custom tags
- Drag terminal A onto terminal B → "Create Group" dialog → enter name → both get `custom:<name>` tag

### Cluster UI Entry

Toolbar dropdown menu with available rules. Also bindable to keyboard shortcut.

## Terminal Creation

### Canvas Right-Click

```
Right-click empty canvas → "New Terminal"
  → submenu: select project → select worktree → select type
  → tile created at click position (snapped to 10px)
  → collision pushes nearby tiles
```

### Session Panel Right-Click

```
Right-click worktree node in session panel → "New Terminal" → select type
  → project/worktree implicit
  → position: near existing tiles of same worktree, or viewport center if none
```

### Agent Spawn

- `parentTerminalId` retained
- Position: adjacent to parent tile (right or below, 8px gap)
- Collision pushes other tiles

## Stash

Stash semantics change slightly:

- **Stash** = hide tile from canvas, move to session panel "Stashed" section
- **Un-stash** = restore to canvas. Restore original position if no collision, otherwise viewport center
- Stashed terminals retain `x/y/width/height` for position restoration

## Minimized Terminals

- Minimized tile stays on canvas (header-only height, retains width)
- Participates in clustering layout normally

## Data Migration

### Trigger

`schemaVersion` field in persisted state. Missing or `< 2` → run migration.

### Steps

1. Read old `ProjectData[]` with nested `WorktreeData[]` and `TerminalData[]`
2. Convert `span:{cols,rows}` → `width/height` in pixels: `width = cols * tileDims.w + (cols-1) * GRID_GAP`
3. Generate auto-tags: `["project:<name>", "worktree:<name>", "type:<type>"]`
4. Run `clusterByProject()` to compute initial `x/y` for all tiles (fresh layout, not old coordinates)
5. Remove deprecated fields: `span`, project/worktree `position`/`collapsed`/`zIndex`
6. Write `schemaVersion: 2`

### Persisted Structure

```typescript
interface PersistedState {
  schemaVersion: number;
  projects: PersistedProjectData[];  // hierarchy retained for ownership
  stashedTerminals: PersistedStashedTerminal[];
  lastClusterRule?: string;
  positionSnapshot?: Record<string, {x: number; y: number; width: number; height: number}>;
}
```
