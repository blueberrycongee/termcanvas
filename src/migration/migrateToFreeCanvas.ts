import { GRID_GAP } from "../layout.ts";
import { clusterByTag } from "../clustering.ts";

interface LegacyTerminal {
  id: string;
  title: string;
  type: string;
  minimized: boolean;
  focused: boolean;
  ptyId: number | null;
  status: string;
  span?: { cols: number; rows: number };
  [key: string]: unknown;
}

interface LegacyWorktree {
  id: string;
  name: string;
  path: string;
  terminals: LegacyTerminal[];
  [key: string]: unknown;
}

interface LegacyProject {
  id: string;
  name: string;
  path: string;
  worktrees: LegacyWorktree[];
  [key: string]: unknown;
}

interface LegacyState {
  projects: LegacyProject[];
  stashedTerminals: unknown[];
}

interface TileDimensions {
  w: number;
  h: number;
}

interface MigratedTerminalDraft {
  id: string;
  width: number;
  height: number;
  tags: string[];
}

function normalizeSpan(span: LegacyTerminal["span"]): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Number(span?.cols ?? 1)),
    rows: Math.max(1, Number(span?.rows ?? 1)),
  };
}

export function migrateToFreeCanvas(oldState: LegacyState, tileDims: TileDimensions) {
  const terminalDrafts: MigratedTerminalDraft[] = [];

  const projects = oldState.projects.map((project) => {
    const worktrees = project.worktrees.map((worktree) => {
      const terminals = worktree.terminals.map((terminal) => {
        const { span, ...restTerminal } = terminal;
        const normalizedSpan = normalizeSpan(span);
        const width =
          normalizedSpan.cols * tileDims.w + Math.max(0, normalizedSpan.cols - 1) * GRID_GAP;
        const height =
          normalizedSpan.rows * tileDims.h + Math.max(0, normalizedSpan.rows - 1) * GRID_GAP;
        const tags = [
          `project:${project.name}`,
          `worktree:${worktree.name}`,
          `type:${terminal.type}`,
        ];

        terminalDrafts.push({
          id: terminal.id,
          width,
          height,
          tags,
        });

        return {
          ...restTerminal,
          width,
          height,
          tags,
          x: 0,
          y: 0,
        };
      });

      const { position: _ignoredPosition, collapsed: _ignoredCollapsed, ...restWorktree } =
        worktree;
      return {
        ...restWorktree,
        terminals,
      };
    });

    const {
      position: _ignoredPosition,
      collapsed: _ignoredCollapsed,
      zIndex: _ignoredZIndex,
      autoCompact: _ignoredAutoCompact,
      ...restProject
    } = project;

    return {
      ...restProject,
      worktrees,
    };
  });

  const clustered = clusterByTag(terminalDrafts, "project");
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        const nextPosition = clustered.get(terminal.id);
        if (!nextPosition) {
          continue;
        }
        terminal.x = nextPosition.x;
        terminal.y = nextPosition.y;
      }
    }
  }

  return {
    schemaVersion: 2 as const,
    projects,
    stashedTerminals: oldState.stashedTerminals,
  };
}
