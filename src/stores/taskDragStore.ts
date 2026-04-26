import { create } from "zustand";

interface TaskDragStore {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const useTaskDragStore = create<TaskDragStore>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));
