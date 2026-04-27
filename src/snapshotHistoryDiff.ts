import { readWorkspaceSnapshot } from "./snapshotBridge";
import type {
  PersistedProjectData,
  PersistedTerminalData,
} from "./types";

export type DiffKind =
  | "project-added"
  | "project-removed"
  | "project-renamed"
  | "terminal-added"
  | "terminal-removed"
  | "terminal-renamed"
  | "terminal-moved";

export interface DiffEntry {
  /** Stable key for React reconciliation. */
  key: string;
  kind: DiffKind;
  /** Primary label — terminal title for terminal entries, project name for project entries. */
  label: string;
  /** Project context for terminal entries (omitted for project-level entries). */
  context?: string;
  /** Populated for *-renamed entries. */
  rename?: { from: string; to: string };
  /** Populated for terminal-moved entries. */
  delta?: { x: number; y: number };
}

export interface DiffOptions {
  /**
   * Below this Manhattan-distance threshold, position changes are not
   * reported as moves. The default ignores sub-pixel jitter while still
   * surfacing any deliberate drag.
   */
  moveThreshold?: number;
}

interface FlatTerminal {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  x: number;
  y: number;
}

interface FlatProject {
  id: string;
  name: string;
}

interface FlatSnapshot {
  projects: Map<string, FlatProject>;
  terminals: Map<string, FlatTerminal>;
}

function pickTitle(terminal: PersistedTerminalData): string {
  if (terminal.customTitle && terminal.customTitle.trim().length > 0) {
    return terminal.customTitle;
  }
  return terminal.title;
}

function flatten(projects: PersistedProjectData[]): FlatSnapshot {
  const projectMap = new Map<string, FlatProject>();
  const terminals = new Map<string, FlatTerminal>();
  for (const project of projects) {
    projectMap.set(project.id, { id: project.id, name: project.name });
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        terminals.set(terminal.id, {
          id: terminal.id,
          title: pickTitle(terminal),
          projectId: project.id,
          projectName: project.name,
          x: terminal.x,
          y: terminal.y,
        });
      }
    }
  }
  return { projects: projectMap, terminals };
}

function readFlat(body: unknown): FlatSnapshot | null {
  const restored = readWorkspaceSnapshot(body);
  if (!restored || "skipRestore" in restored) return null;
  return flatten(restored.scene.projects);
}

const KIND_ORDER: Record<DiffKind, number> = {
  "project-added": 0,
  "project-removed": 1,
  "project-renamed": 2,
  "terminal-added": 3,
  "terminal-removed": 4,
  "terminal-renamed": 5,
  "terminal-moved": 6,
};

/**
 * Diff two snapshot bodies. Returns an empty array when either body is
 * unreadable — diffing an unreadable snapshot is not actionable, and
 * surfacing a mid-mode error in the modal would be noisier than just
 * showing an empty state.
 */
export function diffSnapshotBodies(
  fromBody: unknown,
  toBody: unknown,
  options: DiffOptions = {},
): DiffEntry[] {
  const moveThreshold = options.moveThreshold ?? 1;
  const from = readFlat(fromBody);
  const to = readFlat(toBody);
  if (!from || !to) return [];

  const out: DiffEntry[] = [];

  for (const [id, project] of to.projects) {
    const prev = from.projects.get(id);
    if (!prev) {
      out.push({
        key: `project-added:${id}`,
        kind: "project-added",
        label: project.name,
      });
      continue;
    }
    if (prev.name !== project.name) {
      out.push({
        key: `project-renamed:${id}`,
        kind: "project-renamed",
        label: project.name,
        rename: { from: prev.name, to: project.name },
      });
    }
  }
  for (const [id, project] of from.projects) {
    if (!to.projects.has(id)) {
      out.push({
        key: `project-removed:${id}`,
        kind: "project-removed",
        label: project.name,
      });
    }
  }

  for (const [id, terminal] of to.terminals) {
    const prev = from.terminals.get(id);
    if (!prev) {
      out.push({
        key: `terminal-added:${id}`,
        kind: "terminal-added",
        label: terminal.title,
        context: terminal.projectName,
      });
      continue;
    }
    if (prev.title !== terminal.title) {
      out.push({
        key: `terminal-renamed:${id}`,
        kind: "terminal-renamed",
        label: terminal.title,
        context: terminal.projectName,
        rename: { from: prev.title, to: terminal.title },
      });
    }
    const dx = terminal.x - prev.x;
    const dy = terminal.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > moveThreshold) {
      out.push({
        key: `terminal-moved:${id}`,
        kind: "terminal-moved",
        label: terminal.title,
        context: terminal.projectName,
        delta: { x: dx, y: dy },
      });
    }
  }
  for (const [id, terminal] of from.terminals) {
    if (!to.terminals.has(id)) {
      out.push({
        key: `terminal-removed:${id}`,
        kind: "terminal-removed",
        label: terminal.title,
        context: terminal.projectName,
      });
    }
  }

  out.sort((a, b) => {
    const o = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (o !== 0) return o;
    return a.label.localeCompare(b.label);
  });
  return out;
}

export function summarizeDiff(entries: DiffEntry[]): {
  added: number;
  removed: number;
  changed: number;
} {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const entry of entries) {
    if (entry.kind === "project-added" || entry.kind === "terminal-added") {
      added += 1;
    } else if (
      entry.kind === "project-removed" ||
      entry.kind === "terminal-removed"
    ) {
      removed += 1;
    } else {
      changed += 1;
    }
  }
  return { added, removed, changed };
}
