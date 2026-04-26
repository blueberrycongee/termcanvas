import { create } from "zustand";
import type { Task, CreateTaskInput, UpdateTaskInput } from "../types";

interface TaskStoreState {
  tasksByProject: Record<string, Task[]>;
  openProjectPath: string | null;
  openDetailTaskId: string | null;
  // Set when the detail drawer should render an unsaved new-task form for
  // the given project. Mutually exclusive with openDetailTaskId — the drawer
  // is either showing an existing task or composing a new one.
  composingForProject: string | null;
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
}

export const useTaskStore = create<TaskStoreState & TaskStoreActions>(
  (set, get) => ({
    tasksByProject: {},
    openProjectPath: null,
    openDetailTaskId: null,
    composingForProject: null,

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
        return {
          tasksByProject: { ...state.tasksByProject, [projectPath]: next },
        };
      }),

    removeTask: (projectPath, id) =>
      set((state) => {
        const existing = state.tasksByProject[projectPath];
        if (!existing) return state;
        return {
          tasksByProject: {
            ...state.tasksByProject,
            [projectPath]: existing.filter((t) => t.id !== id),
          },
          openDetailTaskId:
            state.openDetailTaskId === id ? null : state.openDetailTaskId,
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
  }),
);

export type { Task, CreateTaskInput, UpdateTaskInput };
