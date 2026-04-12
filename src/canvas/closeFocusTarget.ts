import type { ProjectData } from "../types";

interface TerminalRect {
  id: string;
  projectId: string;
  worktreeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function visibleTerminals(projects: ProjectData[]): TerminalRect[] {
  const out: TerminalRect[] = [];
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed || terminal.minimized) continue;
        out.push({
          id: terminal.id,
          projectId: project.id,
          worktreeId: worktree.id,
          x: terminal.x,
          y: terminal.y,
          width: terminal.width,
          height: terminal.height,
        });
      }
    }
  }
  return out;
}

function verticallyOverlap(a: TerminalRect, b: TerminalRect): boolean {
  return a.y < b.y + b.height && a.y + a.height > b.y;
}

function distanceSquared(a: TerminalRect, b: TerminalRect): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function pickClosest(
  candidates: TerminalRect[],
  pivot: TerminalRect,
): TerminalRect | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => distanceSquared(a, pivot) - distanceSquared(b, pivot),
  )[0];
}

function pickRightmostLeftOf(
  candidates: TerminalRect[],
  pivot: TerminalRect,
): TerminalRect | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const aRight = a.x + a.width;
    const bRight = b.x + b.width;
    if (aRight !== bRight) return bRight - aRight;
    return Math.abs(a.y - pivot.y) - Math.abs(b.y - pivot.y);
  })[0];
}

/**
 * Pick the next terminal to focus when `closedTerminalId` is removed.
 *
 * cmd+d is the inverse of cmd+t. cmd+t (terminalPlacement.ts) inserts a new
 * tile at `(focused.right + gap, focused.y)` inside the same worktree, so
 * cmd+d closes the focused tile and lands focus on its spatial-LEFT neighbor
 * in the same worktree, sharing the same row whenever possible. Pressing
 * cmd+t followed by cmd+d round-trips to the original focused tile — that
 * is the symmetry contract.
 *
 * Fallback chain (each level only kicks in when the previous is empty):
 *   1. row-aligned left sibling: same worktree, vertically overlapping closed
 *   2. any-row left sibling: same worktree, right edge ≤ closed left edge
 *   3. closest other tile in the same worktree (center distance)
 *   4. closest tile in the same project, any worktree
 *   5. closest tile in any project (only when the closed terminal's project
 *      is now empty — never silently kicks the user across project lines)
 */
export function pickCloseFocusTarget(
  projects: ProjectData[],
  closedTerminalId: string,
): string | null {
  const all = visibleTerminals(projects);
  const closed = all.find((t) => t.id === closedTerminalId);
  if (!closed) return null;

  const survivors = all.filter((t) => t.id !== closedTerminalId);
  if (survivors.length === 0) return null;

  const sameWorktree = survivors.filter(
    (t) =>
      t.projectId === closed.projectId && t.worktreeId === closed.worktreeId,
  );

  // 1. Row-aligned left sibling — the direct inverse of cmd+t insertion.
  const rowLeft = pickRightmostLeftOf(
    sameWorktree.filter(
      (t) => t.x + t.width <= closed.x && verticallyOverlap(t, closed),
    ),
    closed,
  );
  if (rowLeft) return rowLeft.id;

  // 2. Any left sibling in the same worktree.
  const anyLeft = pickRightmostLeftOf(
    sameWorktree.filter((t) => t.x + t.width <= closed.x),
    closed,
  );
  if (anyLeft) return anyLeft.id;

  // 3. Anything else in the same worktree, by center distance.
  const sameWorktreeNearest = pickClosest(sameWorktree, closed);
  if (sameWorktreeNearest) return sameWorktreeNearest.id;

  // 4. Same project, any worktree.
  const sameProject = survivors.filter(
    (t) => t.projectId === closed.projectId,
  );
  const sameProjectNearest = pickClosest(sameProject, closed);
  if (sameProjectNearest) return sameProjectNearest.id;

  // 5. Last resort: cross-project, only when this project is empty.
  return pickClosest(survivors, closed)?.id ?? null;
}
