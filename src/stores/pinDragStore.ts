import { create } from "zustand";

interface PinDragStore {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const usePinDragStore = create<PinDragStore>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));
