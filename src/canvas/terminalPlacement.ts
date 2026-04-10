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
    const sibling = worktreeAnchor(projects, input.projectId, input.worktreeId);
    if (sibling) {
      anchor = {
        x: sibling.right + ADJACENCY_GAP,
        y: sibling.y,
      };
    } else {
      anchor = input.fallback ?? { x: 0, y: 0 };
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
