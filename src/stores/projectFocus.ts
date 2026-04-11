import type { ProjectData } from "../types/index.ts";

export interface NormalizedProjectFocus {
  projects: ProjectData[];
  focusedProjectId: string | null;
  focusedWorktreeId: string | null;
}

export interface TerminalFocusOrderItem {
  projectId: string;
  worktreeId: string;
  terminalId: string;
  index: number;
}

export interface WorktreeFocusOrderItem {
  projectId: string;
  worktreeId: string;
  index: number;
}

interface SpatialTerminalEntry extends Omit<TerminalFocusOrderItem, "index"> {
  x: number;
  y: number;
  height: number;
}

interface VisualRow {
  entries: SpatialTerminalEntry[];
  anchorY: number;
  averageHeight: number;
}

const MIN_VISUAL_ROW_TOLERANCE = 48;
const VISUAL_ROW_TOLERANCE_FACTOR = 0.35;

function sortByTopLeft(a: SpatialTerminalEntry, b: SpatialTerminalEntry): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.terminalId.localeCompare(b.terminalId);
}

function getVisualRowTolerance(
  rowHeight: number,
  entryHeight: number,
): number {
  const shorterHeight = Math.max(1, Math.min(rowHeight, entryHeight));
  return Math.max(
    MIN_VISUAL_ROW_TOLERANCE,
    shorterHeight * VISUAL_ROW_TOLERANCE_FACTOR,
  );
}

function findVisualRow(
  rows: VisualRow[],
  entry: SpatialTerminalEntry,
): VisualRow | null {
  let bestRow: VisualRow | null = null;
  let bestDelta = Infinity;

  for (const row of rows) {
    const delta = Math.abs(entry.y - row.anchorY);
    if (delta > getVisualRowTolerance(row.averageHeight, entry.height)) {
      continue;
    }
    if (delta < bestDelta) {
      bestDelta = delta;
      bestRow = row;
    }
  }

  return bestRow;
}

function buildVisualRows(entries: SpatialTerminalEntry[]): VisualRow[] {
  const rows: VisualRow[] = [];

  for (const entry of [...entries].sort(sortByTopLeft)) {
    const row = findVisualRow(rows, entry);
    if (!row) {
      rows.push({
        entries: [entry],
        anchorY: entry.y,
        averageHeight: entry.height,
      });
      continue;
    }

    row.entries.push(entry);
    const count = row.entries.length;
    row.anchorY = (row.anchorY * (count - 1) + entry.y) / count;
    row.averageHeight =
      (row.averageHeight * (count - 1) + entry.height) / count;
  }

  rows.sort((a, b) => {
    if (a.anchorY !== b.anchorY) return a.anchorY - b.anchorY;
    const aLeft = Math.min(...a.entries.map((entry) => entry.x));
    const bLeft = Math.min(...b.entries.map((entry) => entry.x));
    if (aLeft !== bLeft) return aLeft - bLeft;
    return a.entries[0]!.terminalId.localeCompare(b.entries[0]!.terminalId);
  });

  for (const row of rows) {
    row.entries.sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return sortByTopLeft(a, b);
    });
  }

  return rows;
}

export function getWorktreeFocusOrder(
  projects: ProjectData[],
): WorktreeFocusOrderItem[] {
  const worktrees: Omit<WorktreeFocusOrderItem, "index">[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      worktrees.push({
        projectId: project.id,
        worktreeId: worktree.id,
      });
    }
  }

  return worktrees.map((w, index) => ({ ...w, index }));
}

export function getTerminalFocusOrder(
  projects: ProjectData[],
): TerminalFocusOrderItem[] {
  const terminals: Omit<TerminalFocusOrderItem, "index">[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.minimized || terminal.stashed) {
          continue;
        }

        terminals.push({
          projectId: project.id,
          worktreeId: worktree.id,
          terminalId: terminal.id,
        });
      }
    }
  }

  return terminals.map((terminal, index) => ({ ...terminal, index }));
}

/**
 * Visual reading order for free-canvas terminals. Drives cmd+] / cmd+[
 * navigation so "next terminal" follows what users perceive as rows instead
 * of the raw top-left y-coordinate of each tile.
 *
 * The old strict scanline order `(y, x)` was too brittle: if one terminal in
 * a visually aligned row sat a bit lower than its neighbors, it would be
 * kicked to the end of the traversal. To match the on-canvas layout better,
 * we first group terminals into rows using a top-edge tolerance relative to
 * tile height, then sort left-to-right inside each row.
 */
export function getSpatialTerminalOrder(
  projects: ProjectData[],
): TerminalFocusOrderItem[] {
  const entries: SpatialTerminalEntry[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.minimized || terminal.stashed) {
          continue;
        }
        entries.push({
          projectId: project.id,
          worktreeId: worktree.id,
          terminalId: terminal.id,
          x: terminal.x,
          y: terminal.y,
          height: terminal.height,
        });
      }
    }
  }

  const orderedEntries = buildVisualRows(entries).flatMap((row) => row.entries);

  return orderedEntries.map((entry, index) => ({
    projectId: entry.projectId,
    worktreeId: entry.worktreeId,
    terminalId: entry.terminalId,
    index,
  }));
}

/**
 * Given the projects before and after a collapse, find the next visible
 * terminal to receive focus. Walks forward from the old focused position,
 * wrapping around if needed.
 */
export function findNextVisibleTerminalId(
  oldProjects: ProjectData[],
  focusedTerminalId: string,
  newProjects: ProjectData[],
): string | null {
  const oldOrder = getTerminalFocusOrder(oldProjects);
  const newOrder = getTerminalFocusOrder(newProjects);

  if (newOrder.length === 0) return null;

  const oldIdx = oldOrder.findIndex((t) => t.terminalId === focusedTerminalId);
  if (oldIdx === -1) return newOrder[0].terminalId;

  const newIds = new Set(newOrder.map((t) => t.terminalId));

  for (let i = oldIdx + 1; i < oldOrder.length; i++) {
    if (newIds.has(oldOrder[i].terminalId)) {
      return oldOrder[i].terminalId;
    }
  }

  for (let i = 0; i < oldIdx; i++) {
    if (newIds.has(oldOrder[i].terminalId)) {
      return oldOrder[i].terminalId;
    }
  }

  return newOrder[0].terminalId;
}

export function normalizeProjectsFocus(
  projects: ProjectData[],
): NormalizedProjectFocus {
  let focusedProjectId: string | null = null;
  let focusedWorktreeId: string | null = null;
  let focusedTerminalId: string | null = null;

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      const focusedTerminal = worktree.terminals.find(
        (terminal) => terminal.focused,
      );
      if (focusedTerminal) {
        focusedProjectId = project.id;
        focusedWorktreeId = worktree.id;
        focusedTerminalId = focusedTerminal.id;
        break;
      }
    }

    if (focusedTerminalId) {
      break;
    }
  }

  const normalizedProjects = projects.map((project) => ({
    ...project,
    worktrees: project.worktrees.map((worktree) => ({
      ...worktree,
      terminals: worktree.terminals.map((terminal) => ({
        ...terminal,
        focused: terminal.id === focusedTerminalId,
      })),
    })),
  }));

  return {
    projects: normalizedProjects,
    focusedProjectId,
    focusedWorktreeId,
  };
}
