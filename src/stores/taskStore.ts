import { create } from "zustand";
import type { Task, CreateTaskInput, UpdateTaskInput } from "../types";

interface TerminalTaskAssignment {
  taskId: string;
  repo: string;
  title: string;
}

interface TaskStoreState {
  tasksByProject: Record<string, Task[]>;
  openProjectPath: string | null;
  openDetailTaskId: string | null;
  // Set when the detail drawer should render an unsaved new-task form for
  // the given project. Mutually exclusive with openDetailTaskId — the drawer
  // is either showing an existing task or composing a new one.
  composingForProject: string | null;
  // Map terminalId → the task it was last dispatched with. Renderer-only;
  // does not persist across reloads. Single task per terminal — replacing on
  // re-drop is the explicit contract.
  terminalTaskMap: Record<string, TerminalTaskAssignment>;
  // Session-scoped filter: when false, the drawer hides done/dropped tasks.
  // Single global flag, not per-project.
  showCompleted: boolean;
}

interface TaskStoreActions {
  setTasks: (projectPath: string, tasks: Task[]) => void;
  upsertTask: (projectPath: string, task: Task) => void;
  removeTask: (projectPath: string, id: string) => void;
  openDrawer: (projectPath: string) => void;
  closeDrawer: () => void;
  toggle: (projectPath: string) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  startCompose: (projectPath: string) => void;
  cancelCompose: () => void;
  assignTaskToTerminal: (
    terminalId: string,
    task: Pick<Task, "id" | "repo" | "title">,
  ) => void;
  clearTerminalAssignment: (terminalId: string) => void;
  setShowCompleted: (v: boolean) => void;
  toggleShowCompleted: () => void;
}

export const useTaskStore = create<TaskStoreState & TaskStoreActions>(
  (set, get) => ({
    tasksByProject: {},
    openProjectPath: null,
    openDetailTaskId: null,
    composingForProject: null,
    terminalTaskMap: {},
    showCompleted: false,

    setTasks: (projectPath, tasks) =>
      set((state) => ({
        tasksByProject: { ...state.tasksByProject, [projectPath]: tasks },
      })),

    upsertTask: (projectPath, task) =>
      set((state) => {
        const existing = state.tasksByProject[projectPath];
        if (!existing) return state;
        const idx = existing.findIndex((t) => t.id === task.id);
        const next =
          idx >= 0
            ? [
                ...existing.slice(0, idx),
                task,
                ...existing.slice(idx + 1),
              ]
            : [task, ...existing];
        // If any terminal is associated with this task, refresh its cached
        // title so renames flow through to the badge without a stale label.
        let nextTerminalMap = state.terminalTaskMap;
        for (const [terminalId, entry] of Object.entries(state.terminalTaskMap)) {
          if (entry.taskId === task.id && entry.title !== task.title) {
            if (nextTerminalMap === state.terminalTaskMap) {
              nextTerminalMap = { ...state.terminalTaskMap };
            }
            nextTerminalMap[terminalId] = { ...entry, title: task.title };
          }
        }
        return {
          tasksByProject: { ...state.tasksByProject, [projectPath]: next },
          terminalTaskMap: nextTerminalMap,
        };
      }),

    removeTask: (projectPath, id) =>
      set((state) => {
        const existing = state.tasksByProject[projectPath];
        if (!existing) return state;
        // Drop any terminal associations pointing at this task so the badge
        // disappears in lockstep with the task itself.
        let nextTerminalMap = state.terminalTaskMap;
        for (const [terminalId, entry] of Object.entries(state.terminalTaskMap)) {
          if (entry.taskId === id) {
            if (nextTerminalMap === state.terminalTaskMap) {
              nextTerminalMap = { ...state.terminalTaskMap };
            }
            delete nextTerminalMap[terminalId];
          }
        }
        return {
          tasksByProject: {
            ...state.tasksByProject,
            [projectPath]: existing.filter((t) => t.id !== id),
          },
          openDetailTaskId:
            state.openDetailTaskId === id ? null : state.openDetailTaskId,
          terminalTaskMap: nextTerminalMap,
        };
      }),

    openDrawer: (projectPath) => {
      if (!get().tasksByProject[projectPath]) {
        window.termcanvas.tasks
          .list(projectPath)
          .then((tasks) => {
            get().setTasks(projectPath, tasks);
          })
          .catch(() => {
            get().setTasks(projectPath, []);
          });
      }
      set({ openProjectPath: projectPath });
    },

    closeDrawer: () =>
      set({
        openProjectPath: null,
        openDetailTaskId: null,
        composingForProject: null,
      }),

    openDetail: (id) => set({ openDetailTaskId: id, composingForProject: null }),

    closeDetail: () =>
      set({ openDetailTaskId: null, composingForProject: null }),

    startCompose: (projectPath) =>
      set({ composingForProject: projectPath, openDetailTaskId: null }),

    cancelCompose: () => set({ composingForProject: null }),

    toggle: (projectPath) => {
      const { openProjectPath, openDrawer } = get();
      if (openProjectPath === projectPath) {
        set({ openProjectPath: null });
      } else {
        openDrawer(projectPath);
      }
    },

    assignTaskToTerminal: (terminalId, task) =>
      set((state) => ({
        terminalTaskMap: {
          ...state.terminalTaskMap,
          [terminalId]: {
            taskId: task.id,
            repo: task.repo,
            title: task.title,
          },
        },
      })),

    clearTerminalAssignment: (terminalId) =>
      set((state) => {
        if (!(terminalId in state.terminalTaskMap)) return state;
        const next = { ...state.terminalTaskMap };
        delete next[terminalId];
        return { terminalTaskMap: next };
      }),

    setShowCompleted: (v) => set({ showCompleted: v }),

    toggleShowCompleted: () =>
      set((state) => ({ showCompleted: !state.showCompleted })),
  }),
);

export type { Task, CreateTaskInput, UpdateTaskInput };
