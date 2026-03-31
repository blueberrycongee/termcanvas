import { create } from "zustand";
import type {
  ProjectData,
  WorktreeData,
  TerminalData,
  TerminalType,
  TerminalStatus,
  TerminalOrigin,
  StashedTerminal,
} from "../types/index.ts";
import {
  getStandardWorktreeWidth,
  getWorktreeSize,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout.ts";
import {
  DEFAULT_SPAN,
  withToggledTerminalStarred,
  withUpdatedTerminalCustomTitle,
  withUpdatedTerminalType,
} from "./terminalState.ts";
import { normalizeProjectsFocus, findNextVisibleTerminalId } from "./projectFocus.ts";
import { useWorkspaceStore } from "./workspaceStore.ts";
import { usePreferencesStore } from "./preferencesStore.ts";
import { logSlowRendererPath, measureRendererSync } from "../utils/devPerf.ts";
import { setTrackSidebar, useTileDimensionsStore } from "./tileDimensionsStore.ts";

interface ProjectStore {
  projects: ProjectData[];
  focusedProjectId: string | null;
  focusedWorktreeId: string | null;

  addProject: (project: ProjectData) => void;
  removeProject: (projectId: string) => void;
  updateProjectPosition: (projectId: string, x: number, y: number) => void;
  toggleProjectCollapse: (projectId: string) => void;
  compactProjectWorktrees: (projectId: string) => void;
  bringToFront: (projectId: string) => void;

  updateWorktreePosition: (
    projectId: string,
    worktreeId: string,
    x: number,
    y: number,
  ) => void;
  toggleWorktreeCollapse: (projectId: string, worktreeId: string) => void;
  removeWorktree: (projectId: string, worktreeId: string) => void;
  syncWorktrees: (
    projectPath: string,
    worktrees: { path: string; branch: string; isMain: boolean }[],
  ) => void;

  addTerminal: (
    projectId: string,
    worktreeId: string,
    terminal: TerminalData,
  ) => void;
  removeTerminal: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
  ) => void;
  updateTerminalPtyId: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    ptyId: number | null,
  ) => void;
  toggleTerminalMinimize: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
  ) => void;
  updateTerminalStatus: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    status: TerminalStatus,
  ) => void;
  updateTerminalSessionId: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    sessionId: string | undefined,
  ) => void;
  updateTerminalAutoApprove: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    autoApprove: boolean,
  ) => void;
  updateTerminalType: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    type: TerminalType,
  ) => void;
  updateTerminalCustomTitle: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    customTitle: string,
  ) => void;
  toggleTerminalStarred: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
  ) => void;
  updateTerminalSpan: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    span: { cols: number; rows: number },
  ) => void;
  reorderTerminal: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    newIndex: number,
  ) => void;
  setFocusedTerminal: (
    terminalId: string | null,
    options?: { focusComposer?: boolean },
  ) => void;
  setFocusedWorktree: (
    projectId: string | null,
    worktreeId: string | null,
  ) => void;
  clearFocus: () => void;

  setProjects: (projects: ProjectData[]) => void;
}

interface ScannedWorktree {
  path: string;
  branch: string;
  isMain: boolean;
}

interface FocusLookup {
  currentFocusedTerminalId: string | null;
  nextProjectId: string | null;
  nextWorktreeId: string | null;
}

interface WorktreeTarget {
  projectId: string;
  worktreeId: string;
}

let idCounter = 0;
export function generateId(): string {
  return `${Date.now()}-${++idCounter}`;
}

export function createTerminal(
  type: TerminalType = "shell",
  title?: string,
  initialPrompt?: string,
  autoApprove?: boolean,
  origin: TerminalOrigin = "user",
  parentTerminalId?: string,
): TerminalData {
  return {
    id: generateId(),
    title: title ?? (type === "shell" ? "Terminal" : type),
    type,
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    span: DEFAULT_SPAN[type],
    origin,
    ...(initialPrompt ? { initialPrompt } : {}),
    ...(autoApprove ? { autoApprove } : {}),
    ...(parentTerminalId ? { parentTerminalId } : {}),
  };
}

function mapTerminals(
  projects: ProjectData[],
  projectId: string,
  worktreeId: string,
  terminalId: string,
  fn: (t: TerminalData) => TerminalData,
): ProjectData[] {
  return projects.map((p) =>
    p.id !== projectId
      ? p
      : {
          ...p,
          worktrees: p.worktrees.map((w) =>
            w.id !== worktreeId
              ? w
              : {
                  ...w,
                  terminals: w.terminals.map((t) =>
                    t.id !== terminalId ? t : fn(t),
                  ),
                },
          ),
        },
  );
}

const OVERLAP_GAP = 40;
const WORKTREE_GAP = 8;
const COMPACT_ROW_WIDTH = getStandardWorktreeWidth();

function markDirty() {
  useWorkspaceStore.getState().markDirty();
}

function getVisibleWorktreeSize(worktree: WorktreeData) {
  return getWorktreeSize(
    worktree.terminals.map((terminal) => terminal.span),
    worktree.collapsed,
  );
}

function resolveWorktreeOverlaps(worktrees: WorktreeData[]): WorktreeData[] {
  if (worktrees.length <= 1) return worktrees;

  const positions = new Map(worktrees.map((w) => [w.id, { ...w.position }]));
  const sorted = [...worktrees].sort(
    (a, b) => positions.get(a.id)!.y - positions.get(b.id)!.y,
  );

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    const currPos = positions.get(curr.id)!;
    const currSize = getVisibleWorktreeSize(curr);

    for (let j = 0; j < i; j++) {
      const prev = sorted[j];
      const prevPos = positions.get(prev.id)!;
      const prevSize = getVisibleWorktreeSize(prev);

      if (
        rectsOverlap(
          { ...prevPos, w: prevSize.w, h: prevSize.h },
          { ...currPos, w: currSize.w, h: currSize.h },
          WORKTREE_GAP,
        )
      ) {
        currPos.y = prevPos.y + prevSize.h + WORKTREE_GAP;
      }
    }
  }

  let changed = false;
  for (const w of worktrees) {
    const pos = positions.get(w.id)!;
    if (pos.x !== w.position.x || pos.y !== w.position.y) {
      changed = true;
      break;
    }
  }
  if (!changed) return worktrees;

  return worktrees.map((w) => ({ ...w, position: positions.get(w.id)! }));
}

function compactWorktreeLayout(worktrees: WorktreeData[]): WorktreeData[] {
  if (worktrees.length <= 1) return worktrees;

  const ordered = worktrees
    .map((worktree, index) => ({
      worktree,
      index,
      size: getVisibleWorktreeSize(worktree),
    }))
    .sort(
      (a, b) =>
        a.worktree.position.y - b.worktree.position.y ||
        a.worktree.position.x - b.worktree.position.x ||
        a.index - b.index,
    );

  const positions = new Map<string, { x: number; y: number }>();
  let rowX = 0;
  let rowY = 0;
  let rowHeight = 0;

  for (const item of ordered) {
    if (rowX > 0 && rowX + item.size.w > COMPACT_ROW_WIDTH) {
      rowX = 0;
      rowY += rowHeight + WORKTREE_GAP;
      rowHeight = 0;
    }

    positions.set(item.worktree.id, { x: rowX, y: rowY });
    rowX += item.size.w + WORKTREE_GAP;
    rowHeight = Math.max(rowHeight, item.size.h);
  }

  let changed = false;
  for (const worktree of worktrees) {
    const nextPosition = positions.get(worktree.id)!;
    if (
      nextPosition.x !== worktree.position.x ||
      nextPosition.y !== worktree.position.y
    ) {
      changed = true;
      break;
    }
  }

  if (!changed) return worktrees;

  return worktrees.map((worktree) => ({
    ...worktree,
    position: positions.get(worktree.id)!,
  }));
}

export function getProjectBounds(p: ProjectData) {
  if (p.worktrees.length === 0) {
    return {
      x: p.position.x,
      y: p.position.y,
      w: 340,
      h: PROJ_TITLE_H + PROJ_PAD + 60 + PROJ_PAD,
    };
  }
  let maxW = 300;
  let totalH = 0;
  for (const wt of p.worktrees) {
    const wtSize = getVisibleWorktreeSize(wt);
    maxW = Math.max(maxW, wt.position.x + wtSize.w);
    totalH = Math.max(totalH, wt.position.y + wtSize.h);
  }
  return {
    x: p.position.x,
    y: p.position.y,
    w: Math.max(340, maxW + PROJ_PAD * 2),
    h: p.collapsed
      ? PROJ_TITLE_H + 8
      : PROJ_TITLE_H + PROJ_PAD + totalH + PROJ_PAD,
  };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap: number,
): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function resolveOverlaps(projects: ProjectData[]): ProjectData[] {
  return measureRendererSync(
    "projectStore.resolveOverlaps",
    () => {
      const withResolvedWorktrees = projects.map((p) => ({
        ...p,
        worktrees: resolveWorktreeOverlaps(p.worktrees),
      }));

      const positions = new Map(
        withResolvedWorktrees.map((p) => [p.id, { ...p.position }]),
      );

      // Sort by x so we sweep left-to-right
      const sorted = [...withResolvedWorktrees].sort(
        (a, b) => positions.get(a.id)!.x - positions.get(b.id)!.x,
      );

      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const prevPos = positions.get(prev.id)!;
        const currPos = positions.get(curr.id)!;

        const prevBounds = getProjectBounds({ ...prev, position: prevPos });
        const currBounds = getProjectBounds({ ...curr, position: currPos });

        if (rectsOverlap(prevBounds, currBounds, OVERLAP_GAP)) {
          currPos.x = prevBounds.x + prevBounds.w + OVERLAP_GAP;
        }
      }

      return withResolvedWorktrees.map((p) => ({
        ...p,
        position: positions.get(p.id)!,
      }));
    },
    {
      thresholdMs: 12,
      details: { projects: projects.length },
    },
  );
}

function syncProjectWorktrees(
  project: ProjectData,
  worktrees: ScannedWorktree[],
): ProjectData {
  const existingByPath = new Map(project.worktrees.map((w) => [w.path, w]));
  const synced = worktrees.map((wt) => {
    const existing = existingByPath.get(wt.path);
    if (!existing) {
      return {
        id: generateId(),
        name: wt.branch,
        path: wt.path,
        position: { x: 0, y: 0 },
        collapsed: true,
        terminals: [],
      };
    }
    if (existing.name === wt.branch) {
      return existing;
    }
    return { ...existing, name: wt.branch };
  });

  if (
    synced.length === project.worktrees.length &&
    synced.every((worktree, index) => worktree === project.worktrees[index])
  ) {
    return project;
  }

  return { ...project, worktrees: synced };
}

function inspectFocus(
  projects: ProjectData[],
  nextTerminalId: string | null,
): FocusLookup {
  let currentFocusedTerminalId: string | null = null;
  let nextProjectId: string | null = null;
  let nextWorktreeId: string | null = null;

  outer: for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.focused && currentFocusedTerminalId === null) {
          currentFocusedTerminalId = terminal.id;
        }
        if (nextTerminalId !== null && terminal.id === nextTerminalId) {
          nextProjectId = project.id;
          nextWorktreeId = worktree.id;
        }
        if (
          currentFocusedTerminalId !== null &&
          (nextTerminalId === null || nextProjectId !== null)
        ) {
          break outer;
        }
      }
    }
  }

  return { currentFocusedTerminalId, nextProjectId, nextWorktreeId };
}

function updateFocusedTerminalFlags(
  projects: ProjectData[],
  previousFocusedTerminalId: string | null,
  nextFocusedTerminalId: string | null,
): ProjectData[] {
  if (previousFocusedTerminalId === nextFocusedTerminalId) {
    return projects;
  }

  let changed = false;
  const updatedProjects = projects.map((project) => {
    let projectChanged = false;
    const updatedWorktrees = project.worktrees.map((worktree) => {
      let worktreeChanged = false;
      const updatedTerminals = worktree.terminals.map((terminal) => {
        const touched =
          terminal.id === previousFocusedTerminalId ||
          terminal.id === nextFocusedTerminalId;
        if (!touched) {
          return terminal;
        }

        const focused = terminal.id === nextFocusedTerminalId;
        if (terminal.focused === focused) {
          return terminal;
        }

        worktreeChanged = true;
        return { ...terminal, focused };
      });

      if (!worktreeChanged) {
        return worktree;
      }

      projectChanged = true;
      return { ...worktree, terminals: updatedTerminals };
    });

    if (!projectChanged) {
      return project;
    }

    changed = true;
    return { ...project, worktrees: updatedWorktrees };
  });

  return changed ? updatedProjects : projects;
}

function findWorktreeTarget(
  projects: ProjectData[],
  projectId: string,
  worktreeId: string,
): WorktreeTarget | null {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return null;
  }

  const worktree = project.worktrees.find((candidate) => candidate.id === worktreeId);
  if (!worktree) {
    return null;
  }

  return {
    projectId: project.id,
    worktreeId: worktree.id,
  };
}

function expandFocusedTerminalAncestors(
  projects: ProjectData[],
  projectId: string | null,
  worktreeId: string | null,
): ProjectData[] {
  if (!projectId || !worktreeId) {
    return projects;
  }

  let changed = false;
  const expandedProjects = projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    let nextProject = project;
    if (project.collapsed) {
      changed = true;
      nextProject = { ...nextProject, collapsed: false };
    }

    const expandedWorktrees = nextProject.worktrees.map((worktree) => {
      if (worktree.id !== worktreeId || !worktree.collapsed) {
        return worktree;
      }

      changed = true;
      return { ...worktree, collapsed: false };
    });

    if (expandedWorktrees !== nextProject.worktrees) {
      nextProject = { ...nextProject, worktrees: expandedWorktrees };
    }

    return nextProject;
  });

  return changed ? resolveOverlaps(expandedProjects) : projects;
}

function expandFocusedWorktreeAncestors(
  projects: ProjectData[],
  projectId: string | null,
  worktreeId: string | null,
): ProjectData[] {
  if (!projectId || !worktreeId) {
    return projects;
  }

  let changed = false;
  const expandedProjects = projects.map((project) => {
    if (project.id !== projectId) {
      return project;
    }

    let nextProject = project;
    if (project.collapsed) {
      changed = true;
      nextProject = { ...nextProject, collapsed: false };
    }

    const expandedWorktrees = nextProject.worktrees.map((worktree) => {
      if (worktree.id !== worktreeId || !worktree.collapsed) {
        return worktree;
      }

      changed = true;
      return { ...worktree, collapsed: false };
    });

    if (expandedWorktrees !== nextProject.worktrees) {
      nextProject = { ...nextProject, worktrees: expandedWorktrees };
    }

    return nextProject;
  });

  return changed ? resolveOverlaps(expandedProjects) : projects;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  focusedProjectId: null,
  focusedWorktreeId: null,

  addProject: (project) => {
    set((state) => ({
      projects: resolveOverlaps([...state.projects, project]),
    }));
    markDirty();
  },

  removeProject: (projectId) => {
    set((state) => {
      const focusedProjectRemoved = state.focusedProjectId === projectId;
      return {
        focusedProjectId: focusedProjectRemoved ? null : state.focusedProjectId,
        focusedWorktreeId: focusedProjectRemoved ? null : state.focusedWorktreeId,
        projects: state.projects.filter((p) => p.id !== projectId),
      };
    });
    markDirty();
  },

  updateProjectPosition: (projectId, x, y) => {
    set((state) => {
      const updated = state.projects.map((p) =>
        p.id !== projectId ? p : { ...p, position: { x, y } },
      );
      return { projects: resolveOverlaps(updated) };
    });
    markDirty();
  },

  toggleProjectCollapse: (projectId) => {
    set((state) => {
      const targetProject = state.projects.find((project) => project.id === projectId);
      if (!targetProject) {
        return state;
      }

      const nextCollapsed = !targetProject.collapsed;
      const currentFocusedTerminalId = nextCollapsed
        ? targetProject.worktrees.flatMap((worktree) => worktree.terminals).find(
            (terminal) => terminal.focused,
          )?.id ?? null
        : null;
      let projects = resolveOverlaps(
        state.projects.map((project) =>
          project.id !== projectId
            ? project
            : { ...project, collapsed: nextCollapsed },
        ),
      );

      if (currentFocusedTerminalId) {
        const nextTerminalId = findNextVisibleTerminalId(
          state.projects,
          currentFocusedTerminalId,
          projects,
        );
        projects = updateFocusedTerminalFlags(
          projects,
          currentFocusedTerminalId,
          nextTerminalId,
        );
        const lookup = inspectFocus(projects, nextTerminalId);
        return {
          focusedProjectId: lookup.nextProjectId,
          focusedWorktreeId: lookup.nextWorktreeId,
          projects,
        };
      }

      return {
        focusedProjectId: state.focusedProjectId,
        focusedWorktreeId: state.focusedWorktreeId,
        projects,
      };
    });
    markDirty();
  },

  compactProjectWorktrees: (projectId) => {
    let changed = false;

    set((state) => {
      const updatedProjects = state.projects.map((project) => {
        if (project.id !== projectId) return project;

        const compactedWorktrees = compactWorktreeLayout(project.worktrees);
        if (compactedWorktrees === project.worktrees) {
          return project;
        }

        changed = true;
        return { ...project, worktrees: compactedWorktrees };
      });

      if (!changed) {
        return state;
      }

      return { projects: resolveOverlaps(updatedProjects) };
    });

    if (changed) {
      markDirty();
    }
  },

  bringToFront: (projectId) =>
    set((state) => {
      const maxZ = Math.max(0, ...state.projects.map((p) => p.zIndex ?? 0));
      return {
        projects: state.projects.map((p) =>
          p.id !== projectId ? p : { ...p, zIndex: maxZ + 1 },
        ),
      };
    }),

  updateWorktreePosition: (projectId, worktreeId, x, y) => {
    set((state) => ({
      projects: resolveOverlaps(
        state.projects.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                worktrees: p.worktrees.map((w) =>
                  w.id !== worktreeId ? w : { ...w, position: { x, y } },
                ),
              },
        ),
      ),
    }));
    markDirty();
  },

  removeWorktree: (projectId, worktreeId) => {
    set((state) => {
      const removedFocusedWorktree =
        state.focusedProjectId === projectId &&
        state.focusedWorktreeId === worktreeId;

      return {
        focusedProjectId: removedFocusedWorktree
          ? projectId
          : state.focusedProjectId,
        focusedWorktreeId: removedFocusedWorktree
          ? null
          : state.focusedWorktreeId,
        projects: resolveOverlaps(
          state.projects.map((p) =>
            p.id !== projectId
              ? p
              : {
                  ...p,
                  worktrees: p.worktrees.filter((w) => w.id !== worktreeId),
                },
          ),
        ),
      };
    });
    markDirty();
  },

  syncWorktrees: (projectPath, worktrees) =>
    set((state) => {
      let changed = false;
      const updatedProjects = state.projects.map((project) => {
        if (project.path !== projectPath) return project;
        const syncedProject = syncProjectWorktrees(project, worktrees);
        if (syncedProject !== project) changed = true;
        return syncedProject;
      });

      if (!changed) {
        return state;
      }

      return { projects: resolveOverlaps(updatedProjects) };
    }),

  toggleWorktreeCollapse: (projectId, worktreeId) => {
    set((state) => {
      const targetProject = state.projects.find((project) => project.id === projectId);
      const targetWorktree = targetProject?.worktrees.find(
        (worktree) => worktree.id === worktreeId,
      );
      if (!targetWorktree) {
        return state;
      }

      const nextCollapsed = !targetWorktree.collapsed;
      const currentFocusedTerminalId = nextCollapsed
        ? targetWorktree.terminals.find((terminal) => terminal.focused)?.id ?? null
        : null;
      let projects = resolveOverlaps(
        state.projects.map((project) =>
          project.id !== projectId
            ? project
            : {
                ...project,
                worktrees: project.worktrees.map((worktree) =>
                  worktree.id !== worktreeId
                    ? worktree
                    : { ...worktree, collapsed: nextCollapsed },
                ),
              },
        ),
      );

      if (currentFocusedTerminalId) {
        const nextTerminalId = findNextVisibleTerminalId(
          state.projects,
          currentFocusedTerminalId,
          projects,
        );
        projects = updateFocusedTerminalFlags(
          projects,
          currentFocusedTerminalId,
          nextTerminalId,
        );
        const lookup = inspectFocus(projects, nextTerminalId);
        return {
          focusedProjectId: lookup.nextProjectId,
          focusedWorktreeId: lookup.nextWorktreeId,
          projects,
        };
      }

      return {
        focusedProjectId: state.focusedProjectId,
        focusedWorktreeId: state.focusedWorktreeId,
        projects,
      };
    });
    markDirty();
  },

  addTerminal: (projectId, worktreeId, terminal) => {
    set((state) => ({
      projects: resolveOverlaps(
        state.projects.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                worktrees: p.worktrees.map((w) =>
                  w.id !== worktreeId
                    ? w
                    : { ...w, terminals: [...w.terminals, terminal] },
                ),
              },
        ),
      ),
    }));
    markDirty();
  },

  removeTerminal: (projectId, worktreeId, terminalId) => {
    const startedAt = performance.now();
    set((state) => {
      let wasFocused = false;
      let adjacentTerminalId: string | null = null;
      for (const p of state.projects) {
        if (p.id !== projectId) continue;
        for (const w of p.worktrees) {
          if (w.id !== worktreeId) continue;
          const idx = w.terminals.findIndex((t) => t.id === terminalId);
          if (idx !== -1 && w.terminals[idx].focused) {
            wasFocused = true;
            // Prefer the terminal after, then before
            if (idx + 1 < w.terminals.length) {
              adjacentTerminalId = w.terminals[idx + 1].id;
            } else if (idx - 1 >= 0) {
              adjacentTerminalId = w.terminals[idx - 1].id;
            }
          }
        }
      }

      const updatedProjects = resolveOverlaps(
        state.projects.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                worktrees: p.worktrees.map((w) =>
                  w.id !== worktreeId
                    ? w
                    : {
                        ...w,
                        terminals: w.terminals.filter(
                          (t) => t.id !== terminalId,
                        ),
                      },
                ),
              },
        ),
      );

      if (!wasFocused) {
        return { projects: updatedProjects };
      }

      if (adjacentTerminalId) {
        return {
          projects: updateFocusedTerminalFlags(
            updatedProjects,
            null,
            adjacentTerminalId,
          ),
        };
      }

      // No adjacent terminal — keep worktree focused so cmd+t still works
      return {
        projects: updatedProjects,
      };
    });
    logSlowRendererPath("projectStore.removeTerminal", startedAt, {
      thresholdMs: 8,
      details: { terminalId },
    });
    markDirty();
  },

  updateTerminalPtyId: (projectId, worktreeId, terminalId, ptyId) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, ptyId }),
      ),
    })),

  toggleTerminalMinimize: (projectId, worktreeId, terminalId) => {
    set((state) => {
      const terminal = state.projects
        .find((p) => p.id === projectId)
        ?.worktrees.find((w) => w.id === worktreeId)
        ?.terminals.find((t) => t.id === terminalId);
      if (!terminal) return state;

      const nextMinimized = !terminal.minimized;
      let projects = mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, minimized: nextMinimized }),
      );

      // When minimizing the focused terminal, jump focus to next visible
      if (nextMinimized && terminal.focused) {
        const nextTerminalId = findNextVisibleTerminalId(
          state.projects,
          terminalId,
          projects,
        );
        projects = updateFocusedTerminalFlags(
          projects,
          terminalId,
          nextTerminalId,
        );
        const lookup = inspectFocus(projects, nextTerminalId);
        return {
          focusedProjectId: lookup.nextProjectId,
          focusedWorktreeId: lookup.nextWorktreeId,
          projects,
        };
      }

      return { projects };
    });
    markDirty();
  },

  updateTerminalStatus: (projectId, worktreeId, terminalId, status) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, status }),
      ),
    })),

  updateTerminalSessionId: (projectId, worktreeId, terminalId, sessionId) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, sessionId }),
      ),
    })),

  updateTerminalAutoApprove: (projectId, worktreeId, terminalId, autoApprove) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, autoApprove: autoApprove || undefined }),
      ),
    })),

  updateTerminalType: (projectId, worktreeId, terminalId, type) =>
    set((state) => ({
      projects: resolveOverlaps(
        mapTerminals(
          state.projects,
          projectId,
          worktreeId,
          terminalId,
          (t) => withUpdatedTerminalType(t, type),
        ),
      ),
    })),

  updateTerminalCustomTitle: (projectId, worktreeId, terminalId, customTitle) => {
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => withUpdatedTerminalCustomTitle(t, customTitle),
      ),
    }));
    markDirty();
  },

  toggleTerminalStarred: (projectId, worktreeId, terminalId) => {
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        withToggledTerminalStarred,
      ),
    }));
    markDirty();
  },

  updateTerminalSpan: (projectId, worktreeId, terminalId, span) => {
    set((state) => ({
      projects: resolveOverlaps(
        mapTerminals(
          state.projects,
          projectId,
          worktreeId,
          terminalId,
          (t) => ({ ...t, span }),
        ),
      ),
    }));
    markDirty();
  },

  reorderTerminal: (projectId, worktreeId, terminalId, newIndex) => {
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              worktrees: p.worktrees.map((w) => {
                if (w.id !== worktreeId) return w;
                const terminals = [...w.terminals];
                const oldIndex = terminals.findIndex((t) => t.id === terminalId);
                if (oldIndex === -1 || oldIndex === newIndex) return w;
                const [moved] = terminals.splice(oldIndex, 1);
                terminals.splice(newIndex, 0, moved);
                return { ...w, terminals };
              }),
            },
      ),
    }));
    markDirty();
  },

  setFocusedTerminal: (terminalId, options) => {
    const startedAt = performance.now();
    const focusLookup = inspectFocus(get().projects, terminalId);

    if (terminalId !== null && focusLookup.nextProjectId === null) {
      return;
    }

    set((state) => {
      const {
        currentFocusedTerminalId,
        nextProjectId,
        nextWorktreeId,
      } = focusLookup;
      const focusedProjects = updateFocusedTerminalFlags(
        state.projects,
        currentFocusedTerminalId,
        terminalId,
      );
      const projects = expandFocusedTerminalAncestors(
        focusedProjects,
        nextProjectId,
        nextWorktreeId,
      );

      if (
        projects === state.projects &&
        nextProjectId === state.focusedProjectId &&
        nextWorktreeId === state.focusedWorktreeId
      ) {
        return state;
      }

      return {
        focusedProjectId: nextProjectId,
        focusedWorktreeId: nextWorktreeId,
        projects,
      };
    });
    if (terminalId && options?.focusComposer !== false) {
      const composerEnabled = usePreferencesStore.getState().composerEnabled;
      if (composerEnabled) {
        window.dispatchEvent(new CustomEvent("termcanvas:focus-composer"));
      } else {
        window.dispatchEvent(new CustomEvent("termcanvas:focus-xterm", { detail: terminalId }));
      }
    }
    logSlowRendererPath("projectStore.setFocusedTerminal", startedAt, {
      thresholdMs: 6,
      details: { terminalId },
    });
  },

  setFocusedWorktree: (projectId, worktreeId) => {
    if (projectId === null && worktreeId === null) {
      get().clearFocus();
      return;
    }

    if (!projectId || !worktreeId) {
      return;
    }

    if (!findWorktreeTarget(get().projects, projectId, worktreeId)) {
      return;
    }

    set((state) => {
      const { currentFocusedTerminalId } = inspectFocus(state.projects, null);
      const focusedProjects = updateFocusedTerminalFlags(
        state.projects,
        currentFocusedTerminalId,
        null,
      );
      const projects = expandFocusedWorktreeAncestors(
        focusedProjects,
        projectId,
        worktreeId,
      );

      if (
        projects === state.projects &&
        projectId === state.focusedProjectId &&
        worktreeId === state.focusedWorktreeId
      ) {
        return state;
      }

      return {
        focusedProjectId: projectId,
        focusedWorktreeId: worktreeId,
        projects,
      };
    });
  },

  clearFocus: () => {
    setTrackSidebar(false);
    set((state) => {
      const { currentFocusedTerminalId } = inspectFocus(state.projects, null);
      const projects = updateFocusedTerminalFlags(
        state.projects,
        currentFocusedTerminalId,
        null,
      );

      if (
        projects === state.projects &&
        state.focusedProjectId === null &&
        state.focusedWorktreeId === null
      ) {
        return state;
      }

      return {
        focusedProjectId: null,
        focusedWorktreeId: null,
        projects,
      };
    });
  },

  setProjects: (projects) => {
    set(() => normalizeProjectsFocus(projects));
    markDirty();
  },
}));

// --- Hierarchy helpers (pure functions, not store actions) ---

export interface TerminalLocation {
  terminal: TerminalData;
  projectId: string;
  worktreeId: string;
}

export function findTerminalById(
  projects: ProjectData[],
  terminalId: string,
): TerminalLocation | null {
  for (const p of projects) {
    for (const w of p.worktrees) {
      const t = w.terminals.find((t) => t.id === terminalId);
      if (t) return { terminal: t, projectId: p.id, worktreeId: w.id };
    }
  }
  return null;
}

export function getChildTerminals(
  projects: ProjectData[],
  terminalId: string,
): TerminalLocation[] {
  const children: TerminalLocation[] = [];
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.parentTerminalId === terminalId) {
          children.push({ terminal: t, projectId: p.id, worktreeId: w.id });
        }
      }
    }
  }
  return children;
}

useTileDimensionsStore.subscribe((state, prev) => {
  if (state.w === prev.w && state.h === prev.h) return;
  const { projects } = useProjectStore.getState();
  if (projects.length === 0) return;
  const resolved = resolveOverlaps(projects);
  if (resolved !== projects) {
    useProjectStore.setState({ projects: resolved });
  }
});

// --- Stash helpers (coordinate across projectStore + stashStore) ---

import { useStashStore } from "./stashStore.ts";
import { destroyTerminalRuntime } from "../terminal/terminalRuntimeStore.ts";

export function stashTerminal(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
  const store = useProjectStore.getState();

  // Mark the terminal as stashed — it stays in the worktree so
  // TerminalRuntimeHandle keeps running and the PTY stays alive.
  // Same principle as worktree collapse.
  const now = Date.now();
  useProjectStore.setState((state) => ({
    projects: state.projects.map((p) =>
      p.id !== projectId
        ? p
        : {
            ...p,
            worktrees: p.worktrees.map((w) =>
              w.id !== worktreeId
                ? w
                : {
                    ...w,
                    terminals: w.terminals.map((t) =>
                      t.id !== terminalId
                        ? t
                        : { ...t, stashed: true, stashedAt: now, focused: false },
                    ),
                  },
            ),
          },
    ),
  }));

  // Also add to stashStore so StashBox UI can display it
  const loc = findTerminalById(store.projects, terminalId);
  if (!loc) return;
  useStashStore.getState().stash({
    terminal: loc.terminal,
    projectId,
    worktreeId,
    stashedAt: loc.terminal.stashedAt ?? Date.now(),
  });
}

export function unstashTerminal(terminalId: string): void {
  // Remove from stash UI store
  useStashStore.getState().unstash(terminalId);

  // Clear the stashed flag — terminal is already in its worktree,
  // TerminalRuntimeHandle never unmounted, PTY is still alive.
  useProjectStore.setState((state) => ({
    projects: state.projects.map((p) => ({
      ...p,
      worktrees: p.worktrees.map((w) => ({
        ...w,
        terminals: w.terminals.map((t) =>
          t.id !== terminalId
            ? t
            : { ...t, stashed: false, stashedAt: undefined },
        ),
      })),
    })),
  }));

  useProjectStore.getState().setFocusedTerminal(terminalId);
}

export function destroyStashedTerminal(terminalId: string): void {
  const entry = useStashStore.getState().unstash(terminalId);
  if (entry) {
    useProjectStore.getState().removeTerminal(entry.projectId, entry.worktreeId, terminalId);
  }
  destroyTerminalRuntime(terminalId);
}

export function destroyAllStashedTerminals(): void {
  const { items } = useStashStore.getState();
  const store = useProjectStore.getState();
  for (const entry of items) {
    store.removeTerminal(entry.projectId, entry.worktreeId, entry.terminal.id);
    destroyTerminalRuntime(entry.terminal.id);
  }
  useStashStore.getState().clear();
}
