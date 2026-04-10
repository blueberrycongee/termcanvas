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
   * placement falls through to the "no anchor" case (target project has no
   * terminals anywhere), the new tile is centred inside this rect so it
   * lands where the user is actually looking instead of at the origin.
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

/**
 * Anchor off the focused terminal in the target worktree, if any. This is
 * the primary cmd+t path: "give me a new terminal next to what I'm working
 * on", mirroring the parent-terminal branch.
 */
function focusedTerminalAnchor(
  projects: ProjectData[],
  projectId: string,
  worktreeId: string,
): { x: number; y: number; right: number } | null {
  const project = projects.find((entry) => entry.id === projectId);
  const worktree = project?.worktrees.find((entry) => entry.id === worktreeId);
  if (!worktree) {
    return null;
  }
  const focused = worktree.terminals.find((t) => t.focused && !t.stashed);
  if (!focused) {
    return null;
  }
  return {
    x: focused.x,
    y: focused.y,
    right: focused.x + focused.width,
  };
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

/**
 * Fallback anchor when the target worktree is empty but other worktrees in
 * the same project still have terminals. Picks the project-wide rightmost
 * tile so the new terminal clusters with its "relatives" instead of landing
 * at the origin.
 */
function projectAnchor(
  projects: ProjectData[],
  projectId: string,
  excludeWorktreeId: string,
): { x: number; y: number; right: number } | null {
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) {
    return null;
  }

  let rightmost: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;
  for (const worktree of project.worktrees) {
    if (worktree.id === excludeWorktreeId) continue;
    for (const tile of worktree.terminals) {
      if (tile.stashed) continue;
      if (!rightmost || tile.x + tile.width > rightmost.x + rightmost.width) {
        rightmost = {
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
        };
      }
    }
  }

  if (!rightmost) {
    return null;
  }
  return {
    x: rightmost.x,
    y: rightmost.y,
    right: rightmost.x + rightmost.width,
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
    // Anchor priority when neither preferredPosition nor parent is given:
    //   1. focused terminal in the target worktree (cmd+t "new tab next
    //      to what I'm working on")
    //   2. rightmost sibling in the target worktree
    //   3. rightmost terminal in another worktree of the same project
    //      ("climb up to find relatives")
    //   4. viewport centre (so an empty project drops the tile in front
    //      of the user, not at the origin)
    //   5. provided fallback or {0, 0}
    const focused = focusedTerminalAnchor(
      projects,
      input.projectId,
      input.worktreeId,
    );
    if (focused) {
      anchor = {
        x: focused.right + ADJACENCY_GAP,
        y: focused.y,
      };
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
        const relative = projectAnchor(
          projects,
          input.projectId,
          input.worktreeId,
        );
        if (relative) {
          anchor = {
            x: relative.right + ADJACENCY_GAP,
            y: relative.y,
          };
        } else if (input.viewportRect) {
          anchor = {
            x: input.viewportRect.x + (input.viewportRect.w - width) / 2,
            y: input.viewportRect.y + (input.viewportRect.h - height) / 2,
          };
        } else {
          anchor = input.fallback ?? { x: 0, y: 0 };
        }
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
