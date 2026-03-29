import { create } from "zustand";

interface SidebarDragStore {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const useSidebarDragStore = create<SidebarDragStore>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));
