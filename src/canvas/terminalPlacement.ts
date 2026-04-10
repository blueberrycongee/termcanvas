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

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const tile of tiles) {
    minX = Math.min(minX, tile.x);
    minY = Math.min(minY, tile.y);
    maxX = Math.max(maxX, tile.x + tile.width);
    maxY = Math.max(maxY, tile.y + tile.height);
  }

  return { x: minX, y: minY, right: maxX, bottom: maxY };
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
        x: sibling.x,
        y: sibling.bottom + ADJACENCY_GAP,
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
