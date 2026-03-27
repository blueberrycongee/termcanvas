# Git Panel Redesign: Graph Rail

**Date:** 2026-03-27

**Goal:** Code-review-oriented git history with visible topology, merge awareness,
and commit range comparison — all within a 200-600px sidebar panel.

## Context

The repository already computes git topology in `src/utils/gitGraph.ts` via
`buildGitGraph`, and `src/hooks/useGitLog.ts` exposes `commits` with lane
assignments plus `edges`. The rendering layer in `GitContent.tsx` ignores this
data entirely — every commit is a flat button with no topology visualization.

## Constraints

- Left panel width: 200-600px
- History list uses absolute-positioned virtual rows (`ROW_HEIGHT=40`) with lazy loading
- Selecting a commit inserts an inline detail panel that shifts rows below by `detailHeight`
- Must reuse existing `buildGitGraph` topology engine

---

## 1. Graph Rail Rendering

### Layout

History area becomes two synchronized layers inside the scroll container:

```
┌──────────┬──────────────────────────┐
│ Graph    │ Commit Info              │
│ Rail     │                          │
│ (SVG)    │ message + refs           │
│          │ hash · author · time     │
│ 40~80px  │ remaining space          │
│ adaptive │                          │
└──────────┴──────────────────────────┘
```

- **GitGraphLayer**: absolutely positioned SVG, renders only visible window nodes/edges
- **CommitListLayer**: existing commit rows, shifted right by rail width

Rail width = `(maxLane + 1) * LANE_WIDTH` where `LANE_WIDTH = 16px`.
Hard cap: `max-width: 80px` (~5 lanes). Linear history (1 lane): 16px.

### Why SVG

- Virtual scroll window renders ~20-30 rows → ~250 SVG elements max
- Native CSS variable support (`var(--accent)`) for theming
- No HiDPI canvas scaling needed

### Graph Elements

1. **Commit Dot**
   - Normal: `r=3` filled circle, lane color
   - Merge (`parents.length > 1`): `r=3` hollow circle, `strokeWidth=1.5`
   - HEAD: `r=4` filled + outer glow ring

2. **Edge**
   - Same-lane: vertical straight line
   - Cross-lane: cubic bezier — exits source vertically, curves into target lane
   - First-parent edge (`parents[0]`): `strokeWidth: 1.5`, full opacity
   - Non-first-parent edge: `strokeWidth: 1`, `opacity: 0.4`

3. **Lane Guide**
   - Faint vertical line (`opacity: 0.15`) for active lanes between commits

### Coordinate Model

- Node center: `y = row * ROW_HEIGHT + ROW_HEIGHT / 2 + extraOffset`
- Lane center: `x = railPadding + lane * LANE_WIDTH`
- `extraOffset` reuses existing detail insertion logic

### Virtual Scroll Integration

SVG renders only the visible window:

```
visibleEdges = edges.filter(e =>
  e.fromRow >= startIndex - 1 && e.toRow <= endIndex + 1
)
```

SVG `viewBox` offset tracks `scrollTop`, aligned with commit row positioning.

---

## 2. Merge Visualization & Branch Identity

### Merge Commit Muting

Merge commits have low information value for review:

- Text color: `var(--text-faint)` instead of `--text-primary`
- Graph node: hollow circle (above)
- Optional compressed row height: `28px` (normal = `40px`)

### Color System

Retain existing `GRAPH_COLORS` (6 colors, modulo cycling):

- Lane 0 (main line): always `var(--accent)`
- Remaining lanes: cycle through other 5 colors
- Consistent within visible range

### Branch Label Enhancement

- Ref tags gain a colored dot matching lane color
- Combine local + remote refs at same commit: `main ⇌ origin/main`

### First-Parent Path Emphasis

- First-parent edges: `strokeWidth: 1.5`, full opacity — forms clear visual "trunk"
- Non-first-parent edges: `strokeWidth: 1`, `opacity: 0.4`

---

## 3. Code Review Interactions

### Commit Range Selection

- **Single click**: select commit, expand detail (existing behavior)
- **Shift+Click**: select range from last clicked to current commit
- Detail panel shows aggregated diff across the range

Visual feedback:
- Range rows: `background: color-mix(in srgb, var(--accent) 6%, transparent)`
- Range endpoints: `2px solid var(--accent)` left border
- Graph rail: lane lines thicken to `strokeWidth: 2.5` within range

Data: new IPC method `diffRange(worktreePath, fromHash, toHash)` calling
`git diff <from>...<to>`. Reuse `parseDiff` + `CommitDetailInline`.

### Branch Filtering

- Click lane line/node in graph rail → highlight that branch
- Or use funnel icon in branch popover
- Non-target commits: `opacity: 0.3`, still occupy space (preserve topology)
- No solo/hide mode — hiding commits breaks row indices

### Detail Panel Enhancements

Added to `CommitDetailInline`:
- Clickable parent hash list (jump to parent commit)
- Merge commit: show "Merged `branch` into `target`"
- File list: line change stats `+42 -17`

---

## 4. Responsive Width & Performance

### Width Adaptation

| Panel Width | Graph Rail | Commit Info |
|-------------|-----------|-------------|
| ≥400px | Full, max 5 lanes | message + hash + author + time |
| 300-400px | Max 3 lanes | hide author |
| 200-300px | Max 2 lanes | hide hash, message + time only |
| <200px | Rail hidden, flat list | truncated message only |

Implementation: `ResizeObserver` on history container, compute
`availableLanes = Math.floor((width * 0.25) / LANE_WIDTH)`,
cap at `min(actualMaxLane, availableLanes, 5)`.

Excess lanes: commits rendered at rightmost visible lane position, clipped.

### Changes Section Compaction

- Default to single-line summary: `● 2 staged · 3 changed` (clickable to expand)
- Collapsed height: `28px`, maximizing history space
- Yellow dot indicator when staged changes exist

### Performance

- ~250 SVG elements in viewport: no Canvas needed
- `buildGitGraph` is O(n·k), PAGE_SIZE=200, k<10: <5ms full recalculation
- No Web Worker, no Canvas, no incremental graph update needed

---

## 5. Data & Rendering Responsibilities

### Keep unchanged

- `src/utils/gitGraph.ts` — pure topology calculation
- `src/hooks/useGitLog.ts` — fetch and expose commits, edges, branches

### Add or extend

- `src/components/LeftPanel/gitContentLayout.ts`
  - Graph layout helpers: lane counts, rail width, overflow, visible nodes/edges
- `src/components/LeftPanel/GitContent.tsx`
  - Integrate `GitGraphLayer` component
  - Reserve rail width in history layout
  - Shift+Click range selection state
  - Synchronized hover/selection across graph and rows
- `src/components/LeftPanel/GitGraphLayer.tsx` (new)
  - SVG rendering of nodes, edges, lane guides
- `electron/git-info.ts`
  - Add `diffRange` IPC handler
- `src/types/index.ts`
  - Add `diffRange` to `TermCanvasAPI.git`

---

## 6. Testing Strategy

### Unit tests

- Rail width calculation at different lane counts
- Lane overflow and capping
- Node coordinates with and without detail offset
- Edge path generation (straight + cross-lane bezier)
- Commit range selection state logic
- Responsive tier calculation from container width

### Component tests

- Graph nodes/edges render for visible commits
- Selecting a commit updates node emphasis and keeps detail aligned
- Shift+Click produces correct range highlight
- Branch filter dims non-target commits
- Overflow lane indicator when exceeding cap

### Manual verification

- Linear history in narrow (200px) panel
- Merge-heavy history with 5+ lanes
- Detail expansion with graph alignment
- Scroll + loadMore without graph flicker
- Changes section collapse/expand

---

## 7. Out of Scope

- Canvas rendering
- Interactive rebase UI
- Right-click context menus for git operations
- File review tracking (seen/unseen)
- Solo/hide branch mode (opacity filter is enough)
- Horizontal/GitHub-style network graph
- Rewriting `buildGitGraph` topology algorithm
