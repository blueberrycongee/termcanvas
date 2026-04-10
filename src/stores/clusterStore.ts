import { create } from "zustand";
import type { ProjectData } from "../types";
import { cluster, type ClusterRule, type ClusterTile } from "../clustering";
import { useProjectStore } from "./projectStore";

interface PositionRecord {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ClusterStore {
  lastRule: ClusterRule | null;
  positionSnapshot: Record<string, PositionRecord> | null;
  applyCluster: (rule: ClusterRule) => void;
  undoCluster: () => void;
  canUndo: () => boolean;
}

function snapshotPositions(projects: ProjectData[]): Record<string, PositionRecord> {
  const snapshot: Record<string, PositionRecord> = {};
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) continue;
        snapshot[terminal.id] = {
          x: terminal.x,
          y: terminal.y,
          width: terminal.width,
          height: terminal.height,
        };
      }
    }
  }
  return snapshot;
}

function collectClusterTiles(projects: ProjectData[]): ClusterTile[] {
  const tiles: ClusterTile[] = [];
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) continue;
        tiles.push({
          id: terminal.id,
          width: terminal.width,
          height: terminal.height,
          tags: terminal.tags,
        });
      }
    }
  }
  return tiles;
}

interface TerminalLocation {
  projectId: string;
  worktreeId: string;
}

function buildTerminalIndex(
  projects: ProjectData[],
): Map<string, TerminalLocation> {
  const index = new Map<string, TerminalLocation>();
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        index.set(terminal.id, {
          projectId: project.id,
          worktreeId: worktree.id,
        });
      }
    }
  }
  return index;
}

export const useClusterStore = create<ClusterStore>((set, get) => ({
  lastRule: null,
  positionSnapshot: null,

  applyCluster: (rule) => {
    const projectStore = useProjectStore.getState();
    const projects = projectStore.projects;
    const snapshot = snapshotPositions(projects);
    const tiles = collectClusterTiles(projects);
    if (tiles.length === 0) {
      return;
    }

    const positions = cluster(tiles, rule);
    const index = buildTerminalIndex(projects);
    for (const [terminalId, position] of positions.entries()) {
      const location = index.get(terminalId);
      if (!location) continue;
      projectStore.updateTerminalPosition(
        location.projectId,
        location.worktreeId,
        terminalId,
        position.x,
        position.y,
      );
    }

    set({ lastRule: rule, positionSnapshot: snapshot });
  },

  undoCluster: () => {
    const snapshot = get().positionSnapshot;
    if (!snapshot) {
      return;
    }
    const projectStore = useProjectStore.getState();
    const index = buildTerminalIndex(projectStore.projects);
    for (const [terminalId, record] of Object.entries(snapshot)) {
      const location = index.get(terminalId);
      if (!location) continue;
      projectStore.updateTerminalPosition(
        location.projectId,
        location.worktreeId,
        terminalId,
        record.x,
        record.y,
      );
      projectStore.updateTerminalSize(
        location.projectId,
        location.worktreeId,
        terminalId,
        record.width,
        record.height,
      );
    }

    set({ lastRule: null, positionSnapshot: null });
  },

  canUndo: () => get().positionSnapshot !== null,
}));
