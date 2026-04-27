import { create } from "zustand";

interface HubStore {
  open: boolean;
  openHub: () => void;
  closeHub: () => void;
  toggleHub: () => void;
}

export const useHubStore = create<HubStore>((set, get) => ({
  open: false,
  openHub: () => set({ open: true }),
  closeHub: () => set({ open: false }),
  toggleHub: () => set({ open: !get().open }),
}));
