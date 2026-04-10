import type { ProjectData } from "../types";
import { resolveCollisions } from "./collisionResolver";

export interface PlacementInput {
  projects: ProjectData[];
  projectId: string;
  worktreeId: string;
  parentTerminalId?: string;
  width: number;
  height: number;
  /**
   * Preferred world-space position. When provided (e.g. for a right-click
   * spawn), the placement is anchored at this point and only the collision
   * resolver is allowed to nudge it.
   */
  preferredPosition?: { x: number; y: number };
  /**
   * Fallback viewport center used when no parent or sibling tiles are
   * available to anchor against.
   */
  fallback?: { x: number; y: number };
  /**
   * Current visible canvas area in world space. When provided and the
   * no-parent/no-preferredPosition path is taken, pickPlacement tries to
   * find a free row-major slot inside this rect before falling back to the
   * rightmost-sibling anchor. This is what makes cmd+t fill the visible
   * screen instead of marching indefinitely off to the right.
   */
  viewportRect?: { x: number; y: number; w: number; h: number };
}

const SNAP_GRID = 10;
const ADJACENCY_GAP = 8;

function snap(value: number): number {
  return Math.round(value / SNAP_GRID) * SNAP_GRID;
}

interface RectInput {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function collectRects(projects: ProjectData[]): RectInput[] {
  const rects: RectInput[] = [];
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) continue;
        rects.push({
          id: terminal.id,
          x: terminal.x,
          y: terminal.y,
          width: terminal.width,
          height: terminal.height,
        });
      }
    }
  }
  return rects;
}

function findTerminal(
  projects: ProjectData[],
  terminalId: string,
): RectInput | null {
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.id === terminalId) {
          return {
            id: terminal.id,
            x: terminal.x,
            y: terminal.y,
            width: terminal.width,
            height: terminal.height,
          };
        }
      }
    }
  }
  return null;
}

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Row-major scan inside `viewportRect` for the first free slot that can
 * hold a (width x height) tile without colliding with any existing tile.
 *
 * When a candidate intersects an existing tile, x advances to the smallest
 * right edge among colliders rather than stepping by a fixed column so that
 * a single wide (user-resized) tile only skips its own width, not an entire
 * grid column. Returns null if the viewport cannot fit the tile anywhere.
 */
function scanViewportGrid(
  viewportRect: { x: number; y: number; w: number; h: number },
  rects: RectInput[],
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (viewportRect.w < width || viewportRect.h < height) {
    return null;
  }
  const xMax = viewportRect.x + viewportRect.w;
  const yMax = viewportRect.y + viewportRect.h;

  let y = snap(viewportRect.y);
  // Row loop — step by height + gap so same-row tiles align on y.
  while (y + height <= yMax) {
    let x = snap(viewportRect.x);
    let guard = 0;
    while (x + width <= xMax && guard < 1000) {
      guard += 1;
      const candidate = { x, y, width, height };
      const colliders = rects.filter((r) => rectsIntersect(candidate, r));
      if (colliders.length === 0) {
        return { x, y };
      }
      const minRight = Math.min(
        ...colliders.map((r) => r.x + r.width),
      );
      const nextX = snap(minRight + ADJACENCY_GAP);
      if (nextX <= x) break; // safety — should never regress
      x = nextX;
    }
    y = snap(y + height + ADJACENCY_GAP);
  }
  return null;
}

function worktreeAnchor(
  projects: ProjectData[],
  projectId: string,
  worktreeId: string,
): { x: number; y: number; bottom: number; right: number } | null {
  const project = projects.find((entry) => entry.id === projectId);
  const worktree = project?.worktrees.find((entry) => entry.id === worktreeId);
  if (!worktree) {
    return null;
  }

  const tiles = worktree.terminals.filter((t) => !t.stashed);
  if (tiles.length === 0) {
    return null;
  }

  // Anchor off the rightmost sibling so new terminals flow horizontally
  // (matching the parent-terminal branch below). Keep the new tile aligned
  // with the rightmost sibling's top edge.
  let rightmost = tiles[0];
  for (const tile of tiles) {
    if (tile.x + tile.width > rightmost.x + rightmost.width) {
      rightmost = tile;
    }
  }

  return {
    x: rightmost.x,
    y: rightmost.y,
    right: rightmost.x + rightmost.width,
    bottom: rightmost.y + rightmost.height,
  };
}

export interface PlacementResult {
  x: number;
  y: number;
  /** Other terminals nudged out of the way (already collision-resolved). */
  nudged: Array<{ id: string; x: number; y: number }>;
}

export function pickPlacement(input: PlacementInput): PlacementResult {
  const { projects, parentTerminalId, width, height } = input;

  let anchor: { x: number; y: number };

  if (input.preferredPosition) {
    anchor = input.preferredPosition;
  } else if (parentTerminalId) {
    const parent = findTerminal(projects, parentTerminalId);
    if (parent) {
      anchor = {
        x: parent.x + parent.width + ADJACENCY_GAP,
        y: parent.y,
      };
    } else {
      anchor = input.fallback ?? { x: 0, y: 0 };
    }
  } else {
    // Prefer a free slot inside the visible viewport so cmd+t fills the
    // screen instead of marching off to the right. Only fall back to the
    // rightmost-sibling anchor when the viewport has no room.
    const existingRects = collectRects(projects);
    const viewportSlot = input.viewportRect
      ? scanViewportGrid(input.viewportRect, existingRects, width, height)
      : null;
    if (viewportSlot) {
      anchor = viewportSlot;
    } else {
      const sibling = worktreeAnchor(
        projects,
        input.projectId,
        input.worktreeId,
      );
      if (sibling) {
        anchor = {
          x: sibling.right + ADJACENCY_GAP,
          y: sibling.y,
        };
      } else {
        anchor = input.fallback ?? { x: 0, y: 0 };
      }
    }
  }

  const x = snap(anchor.x);
  const y = snap(anchor.y);

  const placeholderId = "__placement_placeholder__";
  const allRects = collectRects(projects);
  allRects.push({ id: placeholderId, x, y, width, height });

  const resolved = resolveCollisions(allRects, ADJACENCY_GAP, placeholderId);
  const placeholder = resolved.find((rect) => rect.id === placeholderId);

  const nudged: Array<{ id: string; x: number; y: number }> = [];
  for (const rect of resolved) {
    if (rect.id === placeholderId) continue;
    const original = allRects.find((entry) => entry.id === rect.id);
    if (original && (original.x !== rect.x || original.y !== rect.y)) {
      nudged.push({ id: rect.id, x: rect.x, y: rect.y });
    }
  }

  return {
    x: placeholder?.x ?? x,
    y: placeholder?.y ?? y,
    nudged,
  };
}
