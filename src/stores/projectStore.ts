import { create } from "zustand";
import type {
  ProjectData,
  WorktreeData,
  TerminalData,
  TerminalType,
  TerminalStatus,
  TerminalOrigin,
} from "../types";
import { computeWorktreeSize, PROJ_PAD, PROJ_TITLE_H } from "../layout";
import { DEFAULT_SPAN, withUpdatedTerminalType } from "./terminalState";
import { normalizeProjectsFocus } from "./projectFocus";

interface ProjectStore {
  projects: ProjectData[];
  focusedProjectId: string | null;
  focusedWorktreeId: string | null;

  addProject: (project: ProjectData) => void;
  removeProject: (projectId: string) => void;
  updateProjectPosition: (projectId: string, x: number, y: number) => void;
  toggleProjectCollapse: (projectId: string) => void;
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
    ptyId: number,
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
    sessionId: string,
  ) => void;
  updateTerminalType: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
    type: TerminalType,
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
  setFocusedTerminal: (terminalId: string | null) => void;
  setFocusedWorktree: (
    projectId: string | null,
    worktreeId: string | null,
  ) => void;
  clearFocus: () => void;

  setProjects: (projects: ProjectData[]) => void;
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

function resolveWorktreeOverlaps(worktrees: WorktreeData[]): WorktreeData[] {
  if (worktrees.length <= 1) return worktrees;

  const positions = new Map(worktrees.map((w) => [w.id, { ...w.position }]));

  // Sort by y so we sweep top-to-bottom
  const sorted = [...worktrees].sort(
    (a, b) => positions.get(a.id)!.y - positions.get(b.id)!.y,
  );

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevPos = positions.get(prev.id)!;
    const currPos = positions.get(curr.id)!;

    const prevSize = computeWorktreeSize(prev.terminals.map((t) => t.span));
    const currSize = computeWorktreeSize(curr.terminals.map((t) => t.span));

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
    const wtSize = computeWorktreeSize(wt.terminals.map((t) => t.span));
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
  // First resolve worktree overlaps within each project
  const withResolvedWorktrees = projects.map((p) => ({
    ...p,
    worktrees: resolveWorktreeOverlaps(p.worktrees),
  }));

  // Then resolve project overlaps
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
      // Push current project to the right edge of previous + gap
      currPos.x = prevBounds.x + prevBounds.w + OVERLAP_GAP;
    }
  }

  return withResolvedWorktrees.map((p) => ({
    ...p,
    position: positions.get(p.id)!,
  }));
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  focusedProjectId: null,
  focusedWorktreeId: null,

  addProject: (project) =>
    set((state) => ({
      projects: resolveOverlaps([...state.projects, project]),
    })),

  removeProject: (projectId) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
    })),

  updateProjectPosition: (projectId, x, y) =>
    set((state) => {
      const updated = state.projects.map((p) =>
        p.id !== projectId ? p : { ...p, position: { x, y } },
      );
      return { projects: resolveOverlaps(updated) };
    }),

  toggleProjectCollapse: (projectId) =>
    set((state) => ({
      projects: resolveOverlaps(
        state.projects.map((p) =>
          p.id !== projectId ? p : { ...p, collapsed: !p.collapsed },
        ),
      ),
    })),

  bringToFront: (projectId) =>
    set((state) => {
      const maxZ = Math.max(0, ...state.projects.map((p) => p.zIndex ?? 0));
      return {
        projects: state.projects.map((p) =>
          p.id !== projectId ? p : { ...p, zIndex: maxZ + 1 },
        ),
      };
    }),

  updateWorktreePosition: (projectId, worktreeId, x, y) =>
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
    })),

  removeWorktree: (projectId, worktreeId) =>
    set((state) => ({
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
    })),

  syncWorktrees: (projectPath, worktrees) =>
    set((state) => ({
      projects: resolveOverlaps(
        state.projects.map((p) => {
          if (p.path !== projectPath) return p;
          const existingByPath = new Map(p.worktrees.map((w) => [w.path, w]));
          const synced = worktrees.map((wt) => {
            const existing = existingByPath.get(wt.path);
            if (existing) {
              return { ...existing, name: wt.branch };
            }
            return {
              id: generateId(),
              name: wt.branch,
              path: wt.path,
              position: { x: 0, y: 0 },
              collapsed: false,
              terminals: [],
            };
          });
          return { ...p, worktrees: synced };
        }),
      ),
    })),

  toggleWorktreeCollapse: (projectId, worktreeId) =>
    set((state) => ({
      projects: resolveOverlaps(
        state.projects.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                worktrees: p.worktrees.map((w) =>
                  w.id !== worktreeId ? w : { ...w, collapsed: !w.collapsed },
                ),
              },
        ),
      ),
    })),

  addTerminal: (projectId, worktreeId, terminal) =>
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
    })),

  removeTerminal: (projectId, worktreeId, terminalId) =>
    set((state) => {
      // Check if the terminal being removed is focused
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

      // Transfer focus to adjacent terminal in the same worktree
      if (adjacentTerminalId) {
        return {
          projects: updatedProjects.map((p) => ({
            ...p,
            worktrees: p.worktrees.map((w) => ({
              ...w,
              terminals: w.terminals.map((t) => ({
                ...t,
                focused: t.id === adjacentTerminalId,
              })),
            })),
          })),
        };
      }

      // No adjacent terminal — clear focus
      return {
        focusedProjectId: null,
        focusedWorktreeId: null,
        projects: updatedProjects,
      };
    }),

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

  toggleTerminalMinimize: (projectId, worktreeId, terminalId) =>
    set((state) => ({
      projects: mapTerminals(
        state.projects,
        projectId,
        worktreeId,
        terminalId,
        (t) => ({ ...t, minimized: !t.minimized }),
      ),
    })),

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

  updateTerminalSpan: (projectId, worktreeId, terminalId, span) =>
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
    })),

  reorderTerminal: (projectId, worktreeId, terminalId, newIndex) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              worktrees: p.worktrees.map((w) => {
                if (w.id !== worktreeId) return w;
                const terminals = [...w.terminals];
                const oldIndex = terminals.findIndex(
                  (t) => t.id === terminalId,
                );
                if (oldIndex === -1 || oldIndex === newIndex) return w;
                const [moved] = terminals.splice(oldIndex, 1);
                terminals.splice(newIndex, 0, moved);
                return { ...w, terminals };
              }),
            },
      ),
    })),

  setFocusedTerminal: (terminalId) =>
    set((state) => {
      let projectId: string | null = null;
      let worktreeId: string | null = null;
      if (terminalId) {
        for (const p of state.projects) {
          for (const w of p.worktrees) {
            if (w.terminals.some((t) => t.id === terminalId)) {
              projectId = p.id;
              worktreeId = w.id;
            }
          }
        }
      }
      return {
        focusedProjectId: projectId,
        focusedWorktreeId: worktreeId,
        projects: state.projects.map((p) => ({
          ...p,
          worktrees: p.worktrees.map((w) => ({
            ...w,
            terminals: w.terminals.map((t) => ({
              ...t,
              focused: t.id === terminalId,
            })),
          })),
        })),
      };
    }),

  setFocusedWorktree: (projectId, worktreeId) =>
    set((state) => ({
      focusedProjectId: projectId,
      focusedWorktreeId: worktreeId,
      projects: state.projects.map((p) => ({
        ...p,
        worktrees: p.worktrees.map((w) => ({
          ...w,
          terminals: w.terminals.map((t) => ({ ...t, focused: false })),
        })),
      })),
    })),

  clearFocus: () =>
    set((state) => ({
      focusedProjectId: null,
      focusedWorktreeId: null,
      projects: state.projects.map((p) => ({
        ...p,
        worktrees: p.worktrees.map((w) => ({
          ...w,
          terminals: w.terminals.map((t) => ({ ...t, focused: false })),
        })),
      })),
    })),

  setProjects: (projects) => set(() => normalizeProjectsFocus(projects)),
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
