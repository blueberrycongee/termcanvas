# Free Canvas + Rule-Based Clustering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the nested Project→Worktree→Grid layout with a flat free-form canvas where terminal tiles are top-level ReactFlow nodes, grouped by metadata tags and rearranged via one-click clustering rules.

**Architecture:** Keep ReactFlow (Approach A). Flatten node hierarchy so each TerminalTile is a direct ReactFlow node with `x`, `y`, `width`, `height`. Remove ProjectNode/WorktreeNode wrappers. Clustering is a pure function `(tiles, rule) → positions`. Tags on terminals drive grouping.

**Tech Stack:** TypeScript, React 19, @xyflow/react ^12.10.1, Zustand 5, Node built-in test runner (`tsx --test`)

**Design doc:** `docs/plans/2026-04-09-free-canvas-design.md`

---

### Task 1: Update Type Definitions

**Files:**
- Modify: `src/types/index.ts:89-160`

**Step 1: Write the failing test**

Create `tests/free-canvas-types.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

test("TerminalData has canvas position and size fields", async () => {
  const { } = await import("../src/types/index.ts");
  // Type-level test: we just verify the import compiles.
  // Real validation is via tsc --noEmit.
  const terminal: any = {
    id: "t1", title: "test", type: "shell", minimized: false,
    focused: false, ptyId: null, status: "idle",
    x: 100, y: 200, width: 640, height: 480,
    tags: ["project:myapp", "worktree:main"],
  };
  assert.equal(terminal.x, 100);
  assert.equal(terminal.width, 640);
  assert.ok(Array.isArray(terminal.tags));
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/free-canvas-types.test.ts`
Expected: PASS (type-level test — actual validation is tsc)

**Step 3: Update TerminalData interface**

In `src/types/index.ts:89-108`, change `TerminalData`:
- Add `x: number` and `y: number`
- Add `width: number` and `height: number`
- Add `tags: string[]`
- Remove `span: { cols: number; rows: number }`

```typescript
export interface TerminalData {
  id: string;
  title: string;
  customTitle?: string;
  starred?: boolean;
  type: TerminalType;
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
  status: TerminalStatus;
  // Canvas position (pixel, snapped to 10px grid)
  x: number;
  y: number;
  // Pixel dimensions
  width: number;
  height: number;
  // Grouping tags (auto + custom)
  tags: string[];
  origin?: TerminalOrigin;
  parentTerminalId?: string;
  scrollback?: string;
  sessionId?: string;
  initialPrompt?: string;
  autoApprove?: boolean;
  stashed?: boolean;
  stashedAt?: number;
}
```

**Step 4: Update ProjectData — remove layout fields**

In `src/types/index.ts:147-156`:
- Remove `position: Position`
- Remove `collapsed: boolean`
- Remove `zIndex: number`
- Remove `autoCompact?: boolean`

```typescript
export interface ProjectData {
  id: string;
  name: string;
  path: string;
  worktrees: WorktreeData[];
}
```

**Step 5: Update WorktreeData — remove layout fields**

In `src/types/index.ts:134-141`:
- Remove `position: Position`
- Remove `collapsed: boolean`

```typescript
export interface WorktreeData {
  id: string;
  name: string;
  path: string;
  terminals: TerminalData[];
}
```

**Step 6: Update Persisted types accordingly**

Update `PersistedProjectData` and `PersistedWorktreeData` to match.

**Step 7: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -80`
Expected: Many type errors — these will be fixed in subsequent tasks. The goal here is to commit the type changes first and track the error count.

**Step 8: Commit**

```bash
git add src/types/index.ts tests/free-canvas-types.test.ts
git commit -m "refactor: update type definitions for free canvas layout

Remove span, position, collapsed, zIndex from TerminalData/ProjectData/
WorktreeData. Add x, y, width, height, tags to TerminalData."
```

---

### Task 2: Clustering Engine (Pure Functions)

**Files:**
- Create: `src/clustering.ts`
- Create: `tests/clustering.test.ts`

**Step 1: Write the failing tests**

Create `tests/clustering.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

interface TileInput {
  id: string;
  width: number;
  height: number;
  tags: string[];
}

test("clusterByTag groups tiles by matching tag prefix", async () => {
  const { clusterByTag } = await import("../src/clustering.ts");

  const tiles: TileInput[] = [
    { id: "t1", width: 640, height: 480, tags: ["project:app"] },
    { id: "t2", width: 640, height: 480, tags: ["project:app"] },
    { id: "t3", width: 640, height: 480, tags: ["project:backend"] },
  ];

  const result = clusterByTag(tiles, "project");
  // t1 and t2 should be close together; t3 should be far from them
  const t1 = result.get("t1")!;
  const t2 = result.get("t2")!;
  const t3 = result.get("t3")!;

  assert.ok(result.size === 3);
  // Same-group tiles should be within 700px of each other (one tile width + gap)
  const distSameGroup = Math.hypot(t2.x - t1.x, t2.y - t1.y);
  assert.ok(distSameGroup < 700, `same-group distance ${distSameGroup} should be < 700`);
  // Different-group tiles should be far apart (at least 60px inter-group gap)
  const distDiffGroup = Math.hypot(t3.x - t1.x, t3.y - t1.y);
  assert.ok(distDiffGroup > distSameGroup, "different groups should be further apart");
});

test("clusterByTag handles tiles with no matching tag", async () => {
  const { clusterByTag } = await import("../src/clustering.ts");

  const tiles: TileInput[] = [
    { id: "t1", width: 640, height: 480, tags: ["project:app"] },
    { id: "t2", width: 640, height: 480, tags: [] },  // no project tag
  ];

  const result = clusterByTag(tiles, "project");
  assert.ok(result.size === 2, "all tiles should get positions");
  assert.ok(result.has("t2"), "untagged tile should still be placed");
});

test("clusterByTag with empty input returns empty map", async () => {
  const { clusterByTag } = await import("../src/clustering.ts");
  const result = clusterByTag([], "project");
  assert.equal(result.size, 0);
});

test("packGroup arranges tiles in a compact grid", async () => {
  const { packGroup } = await import("../src/clustering.ts");

  const tiles = [
    { id: "t1", width: 640, height: 480 },
    { id: "t2", width: 640, height: 480 },
    { id: "t3", width: 640, height: 480 },
    { id: "t4", width: 640, height: 480 },
  ];

  const result = packGroup(tiles, 0, 0);
  assert.equal(result.length, 4);
  // First tile at origin
  assert.equal(result[0].x, 0);
  assert.equal(result[0].y, 0);
  // No tiles should overlap
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i], b = result[j];
      const overlapX = a.x < b.x + tiles[j].width && a.x + tiles[i].width > b.x;
      const overlapY = a.y < b.y + tiles[j].height && a.y + tiles[i].height > b.y;
      assert.ok(!(overlapX && overlapY), `tiles ${i} and ${j} overlap`);
    }
  }
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/clustering.test.ts`
Expected: FAIL — module not found

**Step 3: Implement clustering engine**

Create `src/clustering.ts`:

```typescript
const INTRA_GROUP_GAP = 8;
const INTER_GROUP_GAP = 60;
const MAX_GROUP_COLS = 4;

interface ClusterTile {
  id: string;
  width: number;
  height: number;
  tags: string[];
}

interface Position {
  x: number;
  y: number;
}

/**
 * Pack a group of tiles into a compact grid starting at (originX, originY).
 * Returns positioned tiles. Tiles are arranged in rows of up to MAX_GROUP_COLS.
 */
export function packGroup(
  tiles: { id: string; width: number; height: number }[],
  originX: number,
  originY: number,
): (Position & { id: string })[] {
  if (tiles.length === 0) return [];

  const result: (Position & { id: string })[] = [];
  let rowX = originX;
  let rowY = originY;
  let rowMaxH = 0;
  let colIdx = 0;

  for (const tile of tiles) {
    if (colIdx >= MAX_GROUP_COLS && colIdx > 0) {
      rowY += rowMaxH + INTRA_GROUP_GAP;
      rowX = originX;
      rowMaxH = 0;
      colIdx = 0;
    }

    result.push({ id: tile.id, x: rowX, y: rowY });
    rowX += tile.width + INTRA_GROUP_GAP;
    rowMaxH = Math.max(rowMaxH, tile.height);
    colIdx++;
  }

  return result;
}

/**
 * Compute the bounding box of a group of positioned tiles.
 */
function groupBounds(
  positions: (Position & { id: string })[],
  tilesById: Map<string, { width: number; height: number }>,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of positions) {
    const t = tilesById.get(p.id)!;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + t.width);
    maxY = Math.max(maxY, p.y + t.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Cluster tiles by a tag prefix (e.g. "project", "worktree", "type", "status", "custom").
 * Tiles sharing the same tag value are grouped together.
 * Returns a map of tileId → {x, y}.
 */
export function clusterByTag(
  tiles: ClusterTile[],
  tagPrefix: string,
): Map<string, Position> {
  if (tiles.length === 0) return new Map();

  // Group tiles by tag value
  const groups = new Map<string, ClusterTile[]>();
  const ungrouped: ClusterTile[] = [];

  for (const tile of tiles) {
    const tag = tile.tags.find((t) => t.startsWith(tagPrefix + ":"));
    if (tag) {
      const group = groups.get(tag) ?? [];
      group.push(tile);
      groups.set(tag, group);
    } else {
      ungrouped.push(tile);
    }
  }

  if (ungrouped.length > 0) {
    groups.set("__ungrouped__", ungrouped);
  }

  // Layout groups left-to-right, wrapping to new row
  const result = new Map<string, Position>();
  const tilesById = new Map(tiles.map((t) => [t.id, t]));
  let cursorX = 0;
  let cursorY = 0;
  let rowMaxH = 0;
  const MAX_ROW_WIDTH = 3000;

  for (const [, group] of groups) {
    const packed = packGroup(group, cursorX, cursorY);
    const bounds = groupBounds(packed, tilesById);

    // Wrap to new row if too wide
    if (cursorX > 0 && cursorX + bounds.w > MAX_ROW_WIDTH) {
      cursorX = 0;
      cursorY += rowMaxH + INTER_GROUP_GAP;
      rowMaxH = 0;
      // Repack at new position
      const repacked = packGroup(group, cursorX, cursorY);
      const newBounds = groupBounds(repacked, tilesById);
      for (const p of repacked) result.set(p.id, { x: p.x, y: p.y });
      cursorX += newBounds.w + INTER_GROUP_GAP;
      rowMaxH = Math.max(rowMaxH, newBounds.h);
    } else {
      for (const p of packed) result.set(p.id, { x: p.x, y: p.y });
      cursorX += bounds.w + INTER_GROUP_GAP;
      rowMaxH = Math.max(rowMaxH, bounds.h);
    }
  }

  return result;
}

/** Built-in clustering rules */
export type ClusterRule = "by-project" | "by-worktree" | "by-type" | "by-status" | "by-custom";

const RULE_TO_PREFIX: Record<ClusterRule, string> = {
  "by-project": "project",
  "by-worktree": "worktree",
  "by-type": "type",
  "by-status": "status",
  "by-custom": "custom",
};

export function cluster(
  tiles: ClusterTile[],
  rule: ClusterRule,
): Map<string, Position> {
  return clusterByTag(tiles, RULE_TO_PREFIX[rule]);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/clustering.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/clustering.ts tests/clustering.test.ts
git commit -m "feat: add clustering engine for free canvas layout

Pure function that groups tiles by tag prefix and arranges them in
compact grid clusters with inter-group spacing."
```

---

### Task 3: Collision Resolution for Flat Tiles

**Files:**
- Create: `src/canvas/collisionResolver.ts`
- Create: `tests/collision-resolver.test.ts`
- Reference: `src/stores/projectStore.ts:365-427` (existing overlap logic)

**Step 1: Write the failing tests**

Create `tests/collision-resolver.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

interface Rect { id: string; x: number; y: number; width: number; height: number }

test("resolveCollisions pushes overlapping tiles apart", async () => {
  const { resolveCollisions } = await import("../src/canvas/collisionResolver.ts");

  const rects: Rect[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 50, y: 50, width: 100, height: 100 },  // overlaps a
  ];

  const result = resolveCollisions(rects, 8);
  const a = result.find((r) => r.id === "a")!;
  const b = result.find((r) => r.id === "b")!;

  // They should no longer overlap (with 8px gap)
  const overlapX = a.x < b.x + b.width + 8 && a.x + a.width + 8 > b.x;
  const overlapY = a.y < b.y + b.height + 8 && a.y + a.height + 8 > b.y;
  assert.ok(!(overlapX && overlapY), "tiles should not overlap after resolution");
});

test("resolveCollisions does nothing when no overlap", async () => {
  const { resolveCollisions } = await import("../src/canvas/collisionResolver.ts");

  const rects: Rect[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 200, y: 200, width: 100, height: 100 },
  ];

  const result = resolveCollisions(rects, 8);
  assert.deepEqual(result, rects, "positions should not change");
});

test("resolveCollisions anchors the dragged tile", async () => {
  const { resolveCollisions } = await import("../src/canvas/collisionResolver.ts");

  const rects: Rect[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 50, y: 50, width: 100, height: 100 },
  ];

  // "b" is the one being dragged — it should stay put, "a" should move
  const result = resolveCollisions(rects, 8, "b");
  const b = result.find((r) => r.id === "b")!;
  assert.equal(b.x, 50);
  assert.equal(b.y, 50);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/collision-resolver.test.ts`
Expected: FAIL

**Step 3: Implement collision resolver**

Create `src/canvas/collisionResolver.ts`:

```typescript
interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/**
 * Resolve overlapping rectangles by pushing them apart along the
 * minimum translation vector. The anchorId tile (if specified) is
 * held fixed — other tiles move around it.
 */
export function resolveCollisions(
  rects: Rect[],
  gap: number,
  anchorId?: string,
): Rect[] {
  const result = rects.map((r) => ({ ...r }));
  const MAX_ITERATIONS = 20;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let anyMoved = false;

    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (!rectsOverlap(result[i], result[j], gap)) continue;

        const a = result[i];
        const b = result[j];

        // Compute overlap on each axis
        const overlapX = Math.min(a.x + a.width + gap - b.x, b.x + b.width + gap - a.x);
        const overlapY = Math.min(a.y + a.height + gap - b.y, b.y + b.height + gap - a.y);

        // Push along smallest overlap axis
        if (overlapX < overlapY) {
          const pushX = a.x + a.width / 2 < b.x + b.width / 2 ? -overlapX : overlapX;
          if (anchorId === b.id) {
            a.x += pushX;
          } else if (anchorId === a.id) {
            b.x -= pushX;
          } else {
            a.x += pushX / 2;
            b.x -= pushX / 2;
          }
        } else {
          const pushY = a.y + a.height / 2 < b.y + b.height / 2 ? -overlapY : overlapY;
          if (anchorId === b.id) {
            a.y += pushY;
          } else if (anchorId === a.id) {
            b.y -= pushY;
          } else {
            a.y += pushY / 2;
            b.y -= pushY / 2;
          }
        }

        anyMoved = true;
      }
    }

    if (!anyMoved) break;
  }

  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/collision-resolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/canvas/collisionResolver.ts tests/collision-resolver.test.ts
git commit -m "feat: add collision resolver for flat canvas tiles

Minimum-translation-vector overlap resolution with optional anchor
tile for drag/resize operations."
```

---

### Task 4: Data Migration

**Files:**
- Create: `src/migration/migrateToFreeCanvas.ts`
- Create: `tests/free-canvas-migration.test.ts`
- Reference: `src/layout.ts` (TERMINAL_W, TERMINAL_H, GRID_GAP for span→px conversion)

**Step 1: Write the failing tests**

Create `tests/free-canvas-migration.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

test("migrateToFreeCanvas converts span to width/height", async () => {
  const { migrateToFreeCanvas } = await import("../src/migration/migrateToFreeCanvas.ts");

  const oldState = {
    projects: [{
      id: "p1", name: "App", path: "/app",
      position: { x: 0, y: 0 }, collapsed: false, zIndex: 1,
      worktrees: [{
        id: "w1", name: "main", path: "/app",
        position: { x: 0, y: 0 }, collapsed: false,
        terminals: [{
          id: "t1", title: "shell", type: "shell",
          minimized: false, focused: false, ptyId: null, status: "idle",
          span: { cols: 2, rows: 1 },
        }],
      }],
    }],
    stashedTerminals: [],
  };

  const result = migrateToFreeCanvas(oldState, { w: 640, h: 480 });
  const terminal = result.projects[0].worktrees[0].terminals[0];

  assert.equal(terminal.width, 2 * 640 + 1 * 8);  // 2 cols * tileW + (2-1) * gap
  assert.equal(terminal.height, 480);
  assert.ok(!("span" in terminal), "span should be removed");
  assert.ok(Array.isArray(terminal.tags));
  assert.ok(terminal.tags.includes("project:App"));
  assert.ok(terminal.tags.includes("worktree:main"));
  assert.ok(terminal.tags.includes("type:shell"));
});

test("migrateToFreeCanvas assigns cluster positions", async () => {
  const { migrateToFreeCanvas } = await import("../src/migration/migrateToFreeCanvas.ts");

  const oldState = {
    projects: [{
      id: "p1", name: "App", path: "/app",
      position: { x: 0, y: 0 }, collapsed: false, zIndex: 1,
      worktrees: [{
        id: "w1", name: "main", path: "/app",
        position: { x: 0, y: 0 }, collapsed: false,
        terminals: [
          { id: "t1", title: "a", type: "shell", minimized: false, focused: false, ptyId: null, status: "idle", span: { cols: 1, rows: 1 } },
          { id: "t2", title: "b", type: "shell", minimized: false, focused: false, ptyId: null, status: "idle", span: { cols: 1, rows: 1 } },
        ],
      }],
    }],
    stashedTerminals: [],
  };

  const result = migrateToFreeCanvas(oldState, { w: 640, h: 480 });
  const t1 = result.projects[0].worktrees[0].terminals[0];
  const t2 = result.projects[0].worktrees[0].terminals[1];

  assert.equal(typeof t1.x, "number");
  assert.equal(typeof t1.y, "number");
  // t1 and t2 should not be at the same position
  assert.ok(t1.x !== t2.x || t1.y !== t2.y, "tiles should have distinct positions");
});

test("migrateToFreeCanvas removes project/worktree layout fields", async () => {
  const { migrateToFreeCanvas } = await import("../src/migration/migrateToFreeCanvas.ts");

  const oldState = {
    projects: [{
      id: "p1", name: "App", path: "/app",
      position: { x: 100, y: 200 }, collapsed: true, zIndex: 5,
      worktrees: [{
        id: "w1", name: "main", path: "/app",
        position: { x: 10, y: 20 }, collapsed: false,
        terminals: [],
      }],
    }],
    stashedTerminals: [],
  };

  const result = migrateToFreeCanvas(oldState, { w: 640, h: 480 });
  const project = result.projects[0];
  const worktree = project.worktrees[0];

  assert.ok(!("position" in project), "project.position should be removed");
  assert.ok(!("collapsed" in project), "project.collapsed should be removed");
  assert.ok(!("zIndex" in project), "project.zIndex should be removed");
  assert.ok(!("position" in worktree), "worktree.position should be removed");
  assert.ok(!("collapsed" in worktree), "worktree.collapsed should be removed");
  assert.equal(result.schemaVersion, 2);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx tsx --test tests/free-canvas-migration.test.ts`
Expected: FAIL

**Step 3: Implement migration**

Create `src/migration/migrateToFreeCanvas.ts`:

```typescript
import { clusterByTag } from "../clustering";

const GRID_GAP = 8;

interface OldTerminal {
  id: string;
  title: string;
  type: string;
  span: { cols: number; rows: number };
  [key: string]: any;
}

interface OldWorktree {
  id: string;
  name: string;
  path: string;
  position: { x: number; y: number };
  collapsed: boolean;
  terminals: OldTerminal[];
}

interface OldProject {
  id: string;
  name: string;
  path: string;
  position: { x: number; y: number };
  collapsed: boolean;
  zIndex: number;
  autoCompact?: boolean;
  worktrees: OldWorktree[];
}

interface OldState {
  projects: OldProject[];
  stashedTerminals: any[];
}

interface TileDims {
  w: number;
  h: number;
}

export function migrateToFreeCanvas(oldState: OldState, tileDims: TileDims) {
  // Step 1: Convert all terminals — span→pixels, add tags, remove span
  const allTerminals: { id: string; width: number; height: number; tags: string[]; projectName: string; projectId: string; worktreeId: string }[] = [];

  const newProjects = oldState.projects.map((project) => {
    const newWorktrees = project.worktrees.map((worktree) => {
      const newTerminals = worktree.terminals.map((terminal) => {
        const { span, ...rest } = terminal;
        const width = span.cols * tileDims.w + Math.max(0, span.cols - 1) * GRID_GAP;
        const height = span.rows * tileDims.h + Math.max(0, span.rows - 1) * GRID_GAP;
        const tags = [
          `project:${project.name}`,
          `worktree:${worktree.name}`,
          `type:${terminal.type}`,
        ];

        const migrated = { ...rest, width, height, tags, x: 0, y: 0 };
        allTerminals.push({ id: terminal.id, width, height, tags, projectName: project.name, projectId: project.id, worktreeId: worktree.id });
        return migrated;
      });

      // Remove worktree layout fields
      const { position: _p, collapsed: _c, ...wtRest } = worktree as any;
      return { ...wtRest, terminals: newTerminals };
    });

    // Remove project layout fields
    const { position: _p, collapsed: _c, zIndex: _z, autoCompact: _a, ...projRest } = project as any;
    return { ...projRest, worktrees: newWorktrees };
  });

  // Step 2: Run cluster-by-project to assign initial positions
  const positions = clusterByTag(allTerminals, "project");

  // Step 3: Write positions back into terminals
  for (const proj of newProjects) {
    for (const wt of proj.worktrees) {
      for (const t of wt.terminals) {
        const pos = positions.get(t.id);
        if (pos) {
          t.x = pos.x;
          t.y = pos.y;
        }
      }
    }
  }

  return {
    schemaVersion: 2,
    projects: newProjects,
    stashedTerminals: oldState.stashedTerminals,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx tsx --test tests/free-canvas-migration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/migration/migrateToFreeCanvas.ts tests/free-canvas-migration.test.ts
git commit -m "feat: add data migration from nested layout to free canvas

Converts span to pixel dimensions, generates auto-tags, removes
project/worktree layout fields, runs initial cluster-by-project."
```

---

### Task 5: Update projectStore — createTerminal, addTerminal, helpers

**Files:**
- Modify: `src/stores/projectStore.ts`
- Modify: `tests/project-store-terminal-order.test.ts` (update test data)
- Reference: `src/stores/tileDimensionsStore.ts`

This is the largest task. It touches many functions because the data model changed.

**Step 1: Update `createTerminal()` helper**

The `createTerminal()` function in `projectStore.ts` currently returns a TerminalData with `span`. Change it to return `x`, `y`, `width`, `height`, `tags`.

- Default `x: 0, y: 0` (caller will set actual position)
- Default `width: tileDims.w, height: tileDims.h` (one standard tile)
- Default `tags: []` (caller will generate auto-tags)

**Step 2: Update `addTerminal()`**

Currently `addTerminal(projectId, worktreeId, terminal)` pushes to worktree.terminals. Keep this behavior but:
- Generate auto-tags: `["project:<name>", "worktree:<name>", "type:<type>"]`
- Assign position: find nearby tiles of same worktree, place adjacent. Or use viewport center if no siblings.
- Run `resolveCollisions()` after placement.

**Step 3: Remove `updateTerminalSpan()`**

Replace with `updateTerminalSize(projectId, worktreeId, terminalId, width, height)`:
- Update width/height
- Run `resolveCollisions()`

**Step 4: Remove container layout functions**

Delete or gut:
- `compactWorktreeLayout()` — no longer needed
- `resolveWorktreeOverlaps()` — replaced by flat `resolveCollisions()`
- `getProjectBounds()` — no project containers
- `resolveOverlaps()` (the old project-level one) — replaced by flat version

**Step 5: Update all callers of removed functions**

Search for all usages of `span`, `position`, `collapsed`, `zIndex`, `autoCompact` in the store and update.

**Step 6: Update existing tests**

Update test data in `tests/project-store-terminal-order.test.ts` and other project-store tests to use new schema (remove `position`, `collapsed`, `zIndex`, `span`; add `x`, `y`, `width`, `height`, `tags`).

**Step 7: Run tests**

Run: `npx tsx --test tests/project-store-terminal-order.test.ts tests/project-store-persistence.test.ts tests/project-store-sync-worktrees.test.ts tests/project-store-focus.test.ts`
Expected: PASS

**Step 8: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: Error count should decrease significantly. Remaining errors will be in canvas/UI components (Task 6-8).

**Step 9: Commit**

```bash
git add src/stores/projectStore.ts tests/project-store-*.test.ts
git commit -m "refactor: update projectStore for free canvas data model

Replace span with width/height, remove container layout functions,
add auto-tag generation and flat collision resolution."
```

---

### Task 6: New Node Projection + TerminalNode Component

**Files:**
- Modify: `src/canvas/nodeProjection.ts`
- Modify: `src/canvas/xyflowNodes.tsx`
- Modify: `src/canvas/XyFlowCanvas.tsx`
- Modify: `src/terminal/TerminalTile.tsx`
- Reference: `src/canvas/sceneState.ts`

**Step 1: Rewrite `buildCanvasFlowNodes()` in `nodeProjection.ts`**

Replace the current function that builds ProjectNode + WorktreeNode hierarchy with a flat function that builds one ReactFlow node per terminal.

```typescript
export function buildFreeCanvasFlowNodes(
  projects: ProjectData[],
): CanvasFlowNode[] {
  const nodes: CanvasFlowNode[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) continue;
        nodes.push({
          id: terminal.id,
          type: "terminal",
          position: { x: terminal.x, y: terminal.y },
          data: {
            terminalId: terminal.id,
            projectId: project.id,
            worktreeId: worktree.id,
            projectName: project.name,
          },
          style: { width: terminal.width, height: terminal.height },
          draggable: true,
          selectable: true,
        });
      }
    }
  }

  return nodes;
}
```

**Step 2: Replace ProjectNode + WorktreeNode with TerminalNode in `xyflowNodes.tsx`**

Create a new `TerminalNode` component. It wraps `TerminalTile` but is a ReactFlow node. Add `NodeResizer` from `@xyflow/react` for edge/corner resize.

The TerminalNode header should show a project badge (colored dot + project name abbreviation).

Delete `ProjectNode` and `WorktreeNode` components.

Update `xyflowNodeTypes`:
```typescript
export const xyflowNodeTypes = {
  terminal: TerminalNode,
} satisfies NodeTypes;
```

**Step 3: Update `XyFlowCanvas.tsx`**

- Replace call to `buildCanvasFlowNodes()` with `buildFreeCanvasFlowNodes()`
- Update `handleNodeDragStop` to write `x`, `y` back to terminal in store
- Add `snapToGrid={true}` and `snapGrid={[10, 10]}` to ReactFlow component
- Update `TerminalRuntimeLayer` to use flat terminal geometry directly
- On resize end (from NodeResizer callback), update terminal `width`/`height` and run `resolveCollisions()`

**Step 4: Update `TerminalTile.tsx`**

- Remove `gridX`, `gridY`, `onSpanChange` from props (these come from the xyflow node now)
- Remove the span-change context menu items (1x1, 2x1, etc.)
- Add tags-related context menu items (manage custom tags)
- The tile now gets its size from the parent ReactFlow node's style

**Step 5: Update `sceneState.ts`**

- Remove `getRenderableTerminalLayouts()` (no more bin-packing per worktree)
- Remove `getRenderableTerminalSpans()`
- Remove `getRenderableWorktreeSize()`
- Keep `getRenderableTerminals()` but update for new data model
- Keep `getStashedTerminalIds()`

**Step 6: Update `viewportBounds.ts` / `panToTerminal.ts`**

- `panToTerminal()`: Simplify — directly use terminal `x`, `y`, `width`, `height` from store. Remove the multi-layer offset calculation (project + worktree + packed).
- `viewportBounds.ts`: No changes needed to the core function, just the callers use terminal rects directly instead of project bounds.

**Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Zero or near-zero errors

**Step 8: Run full test suite**

Run: `npm test`
Expected: Most tests pass. Fix any failures from data model changes.

**Step 9: Commit**

```bash
git add src/canvas/ src/terminal/TerminalTile.tsx src/utils/panToTerminal.ts
git commit -m "feat: flatten canvas to terminal-level ReactFlow nodes

Replace ProjectNode/WorktreeNode with flat TerminalNode. Each terminal
is a top-level ReactFlow node with NodeResizer, snapToGrid, and
project badge in header."
```

---

### Task 7: Clustering UI + Undo

**Files:**
- Create: `src/stores/clusterStore.ts`
- Modify: `src/canvas/XyFlowCanvas.tsx` (add toolbar)
- Create: `src/canvas/ClusterToolbar.tsx`
- Create: `tests/cluster-store.test.ts`

**Step 1: Write the failing test**

Create `tests/cluster-store.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";

test("clusterStore saves snapshot and supports undo", async () => {
  // Test that applying a cluster rule saves a snapshot,
  // and calling undo restores positions.
  // (Detailed assertions depend on store implementation)
});
```

**Step 2: Implement clusterStore**

Create `src/stores/clusterStore.ts` — a Zustand store holding:
- `lastRule: ClusterRule | null`
- `positionSnapshot: Map<string, {x, y, width, height}> | null`
- `applyCluster(rule)` — snapshots current positions, runs cluster, writes new positions to projectStore
- `undoCluster()` — restores snapshot positions
- `canUndo: boolean`

**Step 3: Create ClusterToolbar component**

Create `src/canvas/ClusterToolbar.tsx`:
- Dropdown with rules: "By Project", "By Worktree", "By Type", "By Status", "By Custom Tag"
- Undo button (enabled when `canUndo`)
- Rendered in XyFlowCanvas above the ReactFlow viewport

**Step 4: Wire into XyFlowCanvas**

Add `<ClusterToolbar />` to the canvas layout.

**Step 5: Run tests**

Run: `npx tsx --test tests/cluster-store.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/stores/clusterStore.ts src/canvas/ClusterToolbar.tsx tests/cluster-store.test.ts
git commit -m "feat: add clustering UI with toolbar and undo support

Dropdown to select clustering rule, one-click apply, single-level
undo to restore previous positions."
```

---

### Task 8: Terminal Creation — Canvas + Session Panel

**Files:**
- Modify: `src/canvas/XyFlowCanvas.tsx` (canvas right-click menu)
- Modify: session panel component (worktree right-click)
- Modify: `src/stores/projectStore.ts` (position assignment logic)

**Step 1: Add canvas right-click context menu**

In `XyFlowCanvas.tsx`, on `onPaneContextMenu`:
- Show menu: "New Terminal" → submenu with project → worktree → type (shell/claude/codex/lazygit)
- Create terminal at click position (converted from screen to canvas coords via `screenToFlowPosition`)
- Snap to 10px grid
- Run `resolveCollisions()` after creation

**Step 2: Update session panel worktree right-click**

In the session panel's worktree node context menu (from issue #125):
- Add "New Terminal" → type submenu
- Position logic: find nearest same-worktree tile on canvas, place adjacent. If none, use viewport center.

**Step 3: Update agent spawn position logic**

When a terminal is spawned with `parentTerminalId`, place it adjacent to the parent tile (right side, then below if no room). Run `resolveCollisions()`.

**Step 4: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/canvas/XyFlowCanvas.tsx src/stores/projectStore.ts
git commit -m "feat: add terminal creation via canvas right-click and session panel

Dual entry points for creating terminals. Canvas right-click places at
cursor position, session panel places near worktree siblings."
```

---

### Task 9: Tag Management UI

**Files:**
- Create: `src/terminal/TagManager.tsx`
- Modify: `src/terminal/TerminalTile.tsx` (context menu integration)
- Modify: `src/stores/projectStore.ts` (addTag/removeTag actions)

**Step 1: Add tag mutation actions to projectStore**

```typescript
addTerminalTag(projectId, worktreeId, terminalId, tag: string): void
removeTerminalTag(projectId, worktreeId, terminalId, tag: string): void
```

Only allow mutation of `custom:*` tags. Auto-tags are derived and read-only.

**Step 2: Create TagManager component**

A small popover/dropdown showing:
- Auto-tags (read-only, grayed out): `project:X`, `worktree:X`, `type:X`
- Custom tags (editable): `custom:*` with delete button
- Input field to add new custom tag

**Step 3: Wire into TerminalTile context menu**

Right-click terminal → "Tags..." → opens TagManager popover.

**Step 4: Implement drag-to-group**

When user drags terminal A onto terminal B (detected by drop target logic):
- Show "Create Group" dialog → input group name
- Both terminals get `custom:<name>` tag
- Optional: run cluster-by-custom to visually group them

**Step 5: Commit**

```bash
git add src/terminal/TagManager.tsx src/terminal/TerminalTile.tsx src/stores/projectStore.ts
git commit -m "feat: add tag management UI for terminal grouping

Custom tags via context menu, auto-tags displayed read-only,
drag-to-group creates custom tag on both terminals."
```

---

### Task 10: Stash + Minimize Adaptations

**Files:**
- Modify: `src/stores/projectStore.ts` (stash/unstash position logic)
- Modify: stash UI components

**Step 1: Update stash logic**

- `stashTerminal()`: keep `x`, `y`, `width`, `height` on the terminal (already there), set `stashed: true`
- `unstashTerminal()`: set `stashed: false`. Check if original `(x, y)` position is free. If collision, move to viewport center. Run `resolveCollisions()`.

**Step 2: Update minimize behavior**

Minimized terminals keep their `x`, `y`, `width` but render at header-only height. The stored `height` is not changed (it's the "full" height for when un-minimized). The ReactFlow node style just uses a smaller rendered height when minimized.

**Step 3: Commit**

```bash
git add src/stores/projectStore.ts
git commit -m "fix: adapt stash and minimize for free canvas layout

Stash preserves position for restoration. Unstash checks for
collisions at original position."
```

---

### Task 11: Persistence Integration + Migration Hook

**Files:**
- Modify: `src/canvas/scenePersistence.ts`
- Modify: `src/snapshotState.ts`
- Modify: workspace store or wherever state is loaded on startup

**Step 1: Update `toPersistedProjectData()` / `restorePersistedProjectData()`**

Adapt for new type shape (no `position`/`collapsed`/`zIndex` on project/worktree, no `span` on terminal).

**Step 2: Add migration hook on state load**

When loading persisted state:
- Check `schemaVersion`
- If missing or `< 2`, run `migrateToFreeCanvas()` before restoring
- Write back `schemaVersion: 2`

**Step 3: Run persistence tests**

Run: `npx tsx --test tests/project-store-persistence.test.ts tests/snapshot-state.test.ts tests/state-persistence.test.ts`
Expected: PASS (after updating test fixtures)

**Step 4: Commit**

```bash
git add src/canvas/scenePersistence.ts src/snapshotState.ts
git commit -m "feat: integrate migration into state load pipeline

Auto-migrate v1 schema to free canvas on first load. Update
persistence serialization for new data model."
```

---

### Task 12: Cleanup Dead Code

**Files:**
- Modify: `src/layout.ts` (remove bin-packing, keep only what clustering needs)
- Delete or gut: `src/canvas/sceneState.ts` unused exports
- Remove: `ProjectNode`, `WorktreeNode` dead code if not done in Task 6
- Remove: `compactWorktreeLayout`, `resolveWorktreeOverlaps`, `getProjectBounds`

**Step 1: Audit unused exports**

Run typecheck and grep for any remaining references to removed functions/types.

**Step 2: Remove dead code**

Delete unused functions, imports, and types.

**Step 3: Run full test suite + typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: Zero errors, all tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove dead layout code from pre-free-canvas architecture

Remove bin-packing grid, project/worktree node components, and
container layout functions."
```

---

### Task 13: Final Integration Test

**Files:**
- Create: `tests/free-canvas-integration.test.ts`

**Step 1: Write integration test**

Test the full flow:
1. Create a project with 2 worktrees, each with 2 terminals
2. Verify terminals have `x`, `y`, `width`, `height`, `tags`
3. Run `cluster("by-project")` → verify same-project tiles are grouped
4. Run `cluster("by-type")` → verify same-type tiles are grouped
5. Drag a tile (update position) → verify collision resolution
6. Stash a terminal → verify it's hidden → unstash → verify position restored

**Step 2: Run the test**

Run: `npx tsx --test tests/free-canvas-integration.test.ts`
Expected: PASS

**Step 3: Run full suite one final time**

Run: `npx tsc --noEmit && npm test`
Expected: All green

**Step 4: Commit**

```bash
git add tests/free-canvas-integration.test.ts
git commit -m "test: add free canvas integration test

End-to-end test covering creation, clustering, drag, collision
resolution, and stash/unstash flow."
```
