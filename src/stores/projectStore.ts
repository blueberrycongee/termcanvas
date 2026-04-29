import { create } from "zustand";
import type {
  ProjectData,
  WorktreeData,
  TerminalData,
  TerminalType,
  TerminalStatus,
  TerminalOrigin,
  SpatialWaypoint,
  SpatialWaypointSlot,
} from "../types/index.ts";
import {
  filterValidSelectedItems,
  sameSelectedItems,
} from "../canvas/sceneState.ts";
import {
  withToggledTerminalStarred,
  withUpdatedTerminalCustomTitle,
  withUpdatedTerminalType,
} from "./terminalState.ts";
import {
  normalizeProjectsFocus,
  findNextVisibleTerminalId,
} from "./projectFocus.ts";
import { useWorkspaceStore } from "./workspaceStore.ts";
import { usePreferencesStore } from "./preferencesStore.ts";
import { logSlowRendererPath } from "../utils/devPerf.ts";
import { useSelectionStore } from "./selectionStore.ts";
import {
  recomputeTileDimensions,
  setTrackSidebar,
  useTileDimensionsStore,
} from "./tileDimensionsStore.ts";
import { useTerminalRuntimeStateStore } from "./terminalRuntimeStateStore.ts";
import { usePinStore } from "./pinStore.ts";
import { destroyTerminalRuntime } from "../terminal/terminalRuntimeStore.ts";
import { resolveCollisions } from "../canvas/collisionResolver.ts";

interface ProjectStore {
  projects: ProjectData[];
  focusedProjectId: string | null;
  focusedWorktreeId: string | null;

  addProject: (project: ProjectData) => void;
  removeProject: (projectId: string) => void;

  removeWorktree: (projectId: string, worktreeId: string) => void;
  syncWorktrees: (
    projectPath: string,
    worktrees: { path: string; branch: string; isPrimary: boolean }[],
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
  updateTerminalPosition: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    x: number,
    y: number,
  ) => void;
  updateTerminalPositions: (
    updates: Array<{
      projectId: string;
      worktreeId: string;
      terminalId: string;
      x: number;
      y: number;
    }>,
  ) => void;
  updateTerminalSize: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    width: number,
    height: number,
  ) => void;
  addTerminalTag: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    tag: string,
  ) => void;
  removeTerminalTag: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    tag: string,
  ) => void;
  reorderTerminal: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    newIndex: number,
  ) => void;
  setFocusedTerminal: (
    terminalId: string | null,
    options?: { focusComposer?: boolean; focusInput?: boolean },
  ) => void;
  setFocusedWorktree: (
    projectId: string | null,
    worktreeId: string | null,
  ) => void;
  clearFocus: () => void;

  setWaypoint: (
    projectId: string,
    slot: SpatialWaypointSlot,
    waypoint: SpatialWaypoint,
  ) => void;
  clearWaypoint: (projectId: string, slot: SpatialWaypointSlot) => void;

  setProjects: (projects: ProjectData[]) => void;
}

interface ScannedWorktree {
  path: string;
  branch: string;
  isPrimary: boolean;
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
  // Sticky default: once the user has manually resized a terminal, use
  // that size for every subsequent creation. This decouples new-terminal
  // size from the current sidebar state (left-panel width, right-panel
  // collapsed, …) — otherwise two `+ Terminal` clicks on either side of
  // opening the session panel produce visibly different-sized tiles.
  //
  // Fallback path (never resized) still uses the panel-aware computed
  // default from tileDimensionsStore, so a fresh install gets a sensible
  // size on first launch.
  const stored = usePreferencesStore.getState().defaultTerminalSize;
  let w: number;
  let h: number;
  if (stored) {
    w = stored.w;
    h = stored.h;
  } else {
    recomputeTileDimensions();
    const dims = useTileDimensionsStore.getState();
    w = dims.w;
    h = dims.h;
  }
  return {
    id: generateId(),
    title: title ?? (type === "shell" ? "Terminal" : type),
    type,
    minimized: false,
    focused: false,
    ptyId: null,
    status: "idle",
    x: 0,
    y: 0,
    width: w,
    height: h,
    tags: [],
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

function markDirty() {
  useWorkspaceStore.getState().markDirty();
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
        isPrimary: wt.isPrimary,
        terminals: [],
      };
    }
    if (existing.name === wt.branch && existing.isPrimary === wt.isPrimary) {
      return existing;
    }
    return { ...existing, name: wt.branch, isPrimary: wt.isPrimary };
  });

  // Guarantee: the main worktree (path === project.path) must always be
  // present. If the backend scan omitted it for any reason (transient git
  // error, path mismatch, race condition), preserve the existing entry so the
  // session panel never loses the main workspace.
  if (!synced.some((w) => w.path === project.path)) {
    const existingMain = existingByPath.get(project.path);
    if (existingMain) {
      synced.unshift(existingMain);
    }
  }

  if (
    synced.length === project.worktrees.length &&
    synced.every((worktree, index) => worktree === project.worktrees[index])
  ) {
    return project;
  }

  return { ...project, worktrees: synced };
}

function collectWorktreeTerminalIds(worktree: WorktreeData): string[] {
  return worktree.terminals.map((terminal) => terminal.id);
}

function collectProjectTerminalIds(project: ProjectData): string[] {
  return project.worktrees.flatMap((worktree) =>
    collectWorktreeTerminalIds(worktree),
  );
}

function cleanupRemovedTerminalIds(terminalIds: string[]) {
  const uniqueTerminalIds = [...new Set(terminalIds)];
  if (uniqueTerminalIds.length === 0) {
    return;
  }

  const runtimeState = useTerminalRuntimeStateStore.getState();
  const pinState = usePinStore.getState();
  for (const terminalId of uniqueTerminalIds) {
    destroyTerminalRuntime(terminalId, {
      caller: "cleanupRemovedTerminalIds",
      reason: "terminal_removed_from_project_store",
    });
    runtimeState.clearTerminal(terminalId);
    pinState.clearTerminalAssignment(terminalId);
  }
}

function resolveStructuralFocus(
  projects: ProjectData[],
  fallback: { projectId: string | null; worktreeId: string | null },
) {
  const normalized = normalizeProjectsFocus(projects);
  if (normalized.focusedProjectId !== null) {
    return normalized;
  }

  if (!fallback.projectId) {
    return normalized;
  }

  const project = normalized.projects.find(
    (candidate) => candidate.id === fallback.projectId,
  );
  if (!project) {
    return normalized;
  }

  if (!fallback.worktreeId) {
    return {
      ...normalized,
      focusedProjectId: project.id,
      focusedWorktreeId: null,
    };
  }

  const worktree = project.worktrees.find(
    (candidate) => candidate.id === fallback.worktreeId,
  );

  return {
    ...normalized,
    focusedProjectId: project.id,
    focusedWorktreeId: worktree ? worktree.id : null,
  };
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

  const worktree = project.worktrees.find(
    (candidate) => candidate.id === worktreeId,
  );
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
  _projectId: string | null,
  _worktreeId: string | null,
): ProjectData[] {
  return projects;
}

function expandFocusedWorktreeAncestors(
  projects: ProjectData[],
  _projectId: string | null,
  _worktreeId: string | null,
): ProjectData[] {
  return projects;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  focusedProjectId: null,
  focusedWorktreeId: null,

  addProject: (project) => {
    set((state) => ({
      projects: [...state.projects, project],
    }));
    markDirty();
  },

  removeProject: (projectId) => {
    let removedTerminalIds: string[] = [];
    set((state) => {
      const removedProject = state.projects.find(
        (project) => project.id === projectId,
      );
      if (!removedProject) {
        return state;
      }

      removedTerminalIds = collectProjectTerminalIds(removedProject);
      const nextProjects = state.projects.filter(
        (project) => project.id !== projectId,
      );
      const nextFocus = resolveStructuralFocus(nextProjects, {
        projectId:
          state.focusedProjectId === projectId ? null : state.focusedProjectId,
        worktreeId:
          state.focusedProjectId === projectId ? null : state.focusedWorktreeId,
      });

      return {
        focusedProjectId: nextFocus.focusedProjectId,
        focusedWorktreeId: nextFocus.focusedWorktreeId,
        projects: nextFocus.projects,
      };
    });
    cleanupRemovedTerminalIds(removedTerminalIds);
    markDirty();
  },

  removeWorktree: (projectId, worktreeId) => {
    let removedTerminalIds: string[] = [];
    set((state) => {
      const targetProject = state.projects.find(
        (project) => project.id === projectId,
      );
      const removedWorktree = targetProject?.worktrees.find(
        (worktree) => worktree.id === worktreeId,
      );
      if (!targetProject || !removedWorktree) {
        return state;
      }

      removedTerminalIds = collectWorktreeTerminalIds(removedWorktree);
      const nextProjects = state.projects.map((project) =>
        project.id !== projectId
          ? project
          : {
              ...project,
              worktrees: project.worktrees.filter(
                (worktree) => worktree.id !== worktreeId,
              ),
            },
      );
      const removedFocusedWorktree =
        state.focusedProjectId === projectId &&
        state.focusedWorktreeId === worktreeId;
      const nextFocus = resolveStructuralFocus(nextProjects, {
        projectId: removedFocusedWorktree ? projectId : state.focusedProjectId,
        worktreeId: removedFocusedWorktree ? null : state.focusedWorktreeId,
      });

      return {
        focusedProjectId: nextFocus.focusedProjectId,
        focusedWorktreeId: nextFocus.focusedWorktreeId,
        projects: nextFocus.projects,
      };
    });
    cleanupRemovedTerminalIds(removedTerminalIds);
    markDirty();
  },

  syncWorktrees: (projectPath, worktrees) => {
    const currentState = get();
    const targetProject = currentState.projects.find(
      (project) => project.path === projectPath,
    );
    if (!targetProject) {
      return;
    }

    const nextProject = syncProjectWorktrees(targetProject, worktrees);
    if (nextProject === targetProject) {
      return;
    }

    let removedTerminalIds: string[] = [];
    set((state) => {
      const updatedProjects = state.projects.map((project) => {
        if (project.path !== projectPath) return project;
        const nextPaths = new Set(worktrees.map((worktree) => worktree.path));
        removedTerminalIds.push(
          ...project.worktrees
            .filter((worktree) => !nextPaths.has(worktree.path))
            .flatMap((worktree) => collectWorktreeTerminalIds(worktree)),
        );
        return nextProject;
      });

      const nextFocus = resolveStructuralFocus(updatedProjects, {
        projectId: state.focusedProjectId,
        worktreeId: state.focusedWorktreeId,
      });

      return {
        focusedProjectId: nextFocus.focusedProjectId,
        focusedWorktreeId: nextFocus.focusedWorktreeId,
        projects: nextFocus.projects,
      };
    });
    cleanupRemovedTerminalIds(removedTerminalIds);
    markDirty();
  },

  addTerminal: (projectId, worktreeId, terminal) => {
    set((state) => {
      const project = state.projects.find((p) => p.id === projectId);
      const worktree = project?.worktrees.find((w) => w.id === worktreeId);
      const autoTags = [
        `project:${project?.name ?? "unknown"}`,
        `worktree:${worktree?.name ?? "unknown"}`,
        `type:${terminal.type}`,
      ];
      const taggedTerminal = {
        ...terminal,
        tags: [
          ...autoTags,
          ...terminal.tags.filter((t) => t.startsWith("custom:")),
        ],
      };
      return {
        projects: state.projects.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                worktrees: p.worktrees.map((w) =>
                  w.id !== worktreeId
                    ? w
                    : { ...w, terminals: [...w.terminals, taggedTerminal] },
                ),
              },
        ),
      };
    });
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
            if (idx + 1 < w.terminals.length) {
              adjacentTerminalId = w.terminals[idx + 1].id;
            } else if (idx - 1 >= 0) {
              adjacentTerminalId = w.terminals[idx - 1].id;
            }
          }
        }
      }

      const updatedProjects = state.projects.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              worktrees: p.worktrees.map((w) =>
                w.id !== worktreeId
                  ? w
                  : {
                      ...w,
                      terminals: w.terminals.filter((t) => t.id !== terminalId),
                    },
              ),
            },
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

      return {
        projects: updatedProjects,
      };
    });
    logSlowRendererPath("projectStore.removeTerminal", startedAt, {
      thresholdMs: 8,
      details: { terminalId },
    });
    cleanupRemovedTerminalIds([terminalId]);
    markDirty();
  },

  updateTerminalPtyId: (_projectId, _worktreeId, terminalId, ptyId) => {
    useTerminalRuntimeStateStore.getState().setPtyId(terminalId, ptyId);
  },

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

  updateTerminalStatus: (_projectId, _worktreeId, terminalId, status) => {
    useTerminalRuntimeStateStore.getState().setStatus(terminalId, status);
  },

  updateTerminalSessionId: (_projectId, _worktreeId, terminalId, sessionId) => {
    useTerminalRuntimeStateStore.getState().setSessionId(terminalId, sessionId);
  },

  updateTerminalAutoApprove: (
    projectId,
    worktreeId,
    terminalId,
    autoApprove,
  ) => {
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, autoApprove: autoApprove || undefined }),
      ),
    }));
    markDirty();
  },

  updateTerminalType: (projectId, worktreeId, terminalId, type) => {
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => withUpdatedTerminalType(t, type),
      ),
    }));
    markDirty();
  },

  updateTerminalCustomTitle: (
    projectId,
    worktreeId,
    terminalId,
    customTitle,
  ) => {
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

  updateTerminalPosition: (projectId, worktreeId, terminalId, x, y) => {
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, x, y }),
      ),
    }));
    markDirty();
  },

  updateTerminalPositions: (updates) => {
    if (updates.length === 0) {
      return;
    }

    const grouped = new Map<
      string,
      Map<string, { x: number; y: number }>
    >();
    for (const update of updates) {
      const worktreeKey = `${update.projectId}::${update.worktreeId}`;
      let terminals = grouped.get(worktreeKey);
      if (!terminals) {
        terminals = new Map<string, { x: number; y: number }>();
        grouped.set(worktreeKey, terminals);
      }
      terminals.set(update.terminalId, { x: update.x, y: update.y });
    }

    set((state) => ({
      projects: state.projects.map((project) => {
        let projectChanged = false;
        const worktrees = project.worktrees.map((worktree) => {
          const terminals = grouped.get(`${project.id}::${worktree.id}`);
          if (!terminals) {
            return worktree;
          }

          let worktreeChanged = false;
          const nextTerminals = worktree.terminals.map((terminal) => {
            const nextPosition = terminals.get(terminal.id);
            if (
              !nextPosition ||
              (terminal.x === nextPosition.x && terminal.y === nextPosition.y)
            ) {
              return terminal;
            }
            worktreeChanged = true;
            return { ...terminal, x: nextPosition.x, y: nextPosition.y };
          });

          if (!worktreeChanged) {
            return worktree;
          }

          projectChanged = true;
          return { ...worktree, terminals: nextTerminals };
        });

        return projectChanged ? { ...project, worktrees } : project;
      }),
    }));
    markDirty();
  },

  updateTerminalSize: (projectId, worktreeId, terminalId, width, height) => {
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, width, height }),
      ),
    }));
    markDirty();
  },

  addTerminalTag: (projectId, worktreeId, terminalId, tag) => {
    if (!tag.startsWith("custom:")) return;
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => (t.tags.includes(tag) ? t : { ...t, tags: [...t.tags, tag] }),
      ),
    }));
    markDirty();
  },

  removeTerminalTag: (projectId, worktreeId, terminalId, tag) => {
    if (!tag.startsWith("custom:")) return;
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, tags: t.tags.filter((existing) => existing !== tag) }),
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
                const visibleSlots = terminals.flatMap((terminal, index) =>
                  terminal.stashed ? [] : [index],
                );
                const visibleTerminals = visibleSlots.map(
                  (index) => terminals[index],
                );
                const oldVisibleIndex = visibleTerminals.findIndex(
                  (terminal) => terminal.id === terminalId,
                );
                if (
                  oldVisibleIndex === -1 ||
                  oldVisibleIndex === newIndex ||
                  newIndex < 0 ||
                  newIndex >= visibleTerminals.length
                ) {
                  return w;
                }

                const reorderedVisible = [...visibleTerminals];
                const [moved] = reorderedVisible.splice(oldVisibleIndex, 1);
                reorderedVisible.splice(newIndex, 0, moved);

                const nextTerminals = [...terminals];
                visibleSlots.forEach((slot, index) => {
                  nextTerminals[slot] = reorderedVisible[index];
                });

                return { ...w, terminals: nextTerminals };
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
      const { currentFocusedTerminalId, nextProjectId, nextWorktreeId } =
        focusLookup;
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
    if (
      terminalId &&
      options?.focusInput !== false &&
      options?.focusComposer !== false
    ) {
      const composerEnabled = usePreferencesStore.getState().composerEnabled;
      if (composerEnabled) {
        window.dispatchEvent(new CustomEvent("termcanvas:focus-composer"));
      } else {
        window.dispatchEvent(
          new CustomEvent("termcanvas:focus-xterm", { detail: terminalId }),
        );
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

  setWaypoint: (projectId, slot, waypoint) => {
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        const nextWaypoints: Partial<Record<SpatialWaypointSlot, SpatialWaypoint>> = {
          ...(project.waypoints ?? {}),
          [slot]: waypoint,
        };
        return { ...project, waypoints: nextWaypoints };
      }),
    }));
    markDirty();
  },

  clearWaypoint: (projectId, slot) => {
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== projectId) return project;
        if (!project.waypoints || project.waypoints[slot] === undefined) {
          return project;
        }
        const nextWaypoints: Partial<Record<SpatialWaypointSlot, SpatialWaypoint>> = {
          ...project.waypoints,
        };
        delete nextWaypoints[slot];
        return { ...project, waypoints: nextWaypoints };
      }),
    }));
    markDirty();
  },

  setProjects: (projects) => {
    set(() => normalizeProjectsFocus(projects));
    markDirty();
  },
}));

export interface TerminalLocation {
  terminal: TerminalData;
  projectId: string;
  worktreeId: string;
}

export function getProjectBounds(project: ProjectData): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const worktree of project.worktrees) {
    for (const terminal of worktree.terminals) {
      if (terminal.stashed) continue;
      minX = Math.min(minX, terminal.x);
      minY = Math.min(minY, terminal.y);
      maxX = Math.max(maxX, terminal.x + terminal.width);
      maxY = Math.max(maxY, terminal.y + terminal.height);
    }
  }

  if (!isFinite(minX)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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

useProjectStore.subscribe((state, prev) => {
  if (state.projects === prev.projects) {
    return;
  }

  const selectionState = useSelectionStore.getState();
  const nextSelectedItems = filterValidSelectedItems(
    selectionState.selectedItems,
    { projects: state.projects },
  );

  if (!sameSelectedItems(selectionState.selectedItems, nextSelectedItems)) {
    useSelectionStore.setState({ selectedItems: nextSelectedItems });
  }
});

// --- Stash helpers (single source of truth: projectStore.stashed flag) ---

export function stashTerminal(
  projectId: string,
  worktreeId: string,
  terminalId: string,
): void {
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
                        : {
                            ...t,
                            stashed: true,
                            stashedAt: now,
                            focused: false,
                          },
                    ),
                  },
            ),
          },
    ),
  }));
  markDirty();
}

export function unstashTerminal(terminalId: string): void {
  // First, restore the stashed flag using the existing position.
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

  // Resolve any collision between the unstashed tile and currently visible
  // tiles. This both detects whether the original (x, y) is still free and
  // nudges the unstashed tile out of the way if not.
  const projects = useProjectStore.getState().projects;
  const allRects: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        if (terminal.stashed) continue;
        allRects.push({
          id: terminal.id,
          x: terminal.x,
          y: terminal.y,
          width: terminal.width,
          height: terminal.height,
        });
      }
    }
  }
  // Anchor remains the unstashed terminal — collision resolver will only
  // move it when forced and otherwise nudge other tiles.
  const resolved = resolveCollisions(allRects, 8, terminalId);
  const updatePos = useProjectStore.getState().updateTerminalPosition;
  for (const rect of resolved) {
    const original = allRects.find((r) => r.id === rect.id);
    if (!original) continue;
    if (original.x === rect.x && original.y === rect.y) continue;
    for (const project of projects) {
      for (const worktree of project.worktrees) {
        if (worktree.terminals.some((t) => t.id === rect.id)) {
          updatePos(project.id, worktree.id, rect.id, rect.x, rect.y);
        }
      }
    }
  }

  useProjectStore.getState().setFocusedTerminal(terminalId);
  markDirty();
}

export function getStashedTerminals(): Array<{
  terminal: TerminalData;
  projectId: string;
  worktreeId: string;
  stashedAt: number;
}> {
  const { projects } = useProjectStore.getState();
  const result: Array<{
    terminal: TerminalData;
    projectId: string;
    stashedAt: number;
    worktreeId: string;
  }> = [];
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.stashed) {
          result.push({
            terminal: t,
            projectId: p.id,
            stashedAt: t.stashedAt ?? 0,
            worktreeId: w.id,
          });
        }
      }
    }
  }
  return result;
}

export function destroyStashedTerminal(terminalId: string): void {
  const items = getStashedTerminals();
  const entry = items.find((e) => e.terminal.id === terminalId);
  if (entry) {
    useProjectStore
      .getState()
      .removeTerminal(entry.projectId, entry.worktreeId, terminalId);
    return;
  }
  cleanupRemovedTerminalIds([terminalId]);
}

export function destroyAllStashedTerminals(): void {
  const items = getStashedTerminals();
  const store = useProjectStore.getState();
  for (const entry of items) {
    store.removeTerminal(entry.projectId, entry.worktreeId, entry.terminal.id);
  }
}
