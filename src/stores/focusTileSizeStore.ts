import { create } from "zustand";

interface FocusTileSizeStore {
  /** Override dimensions for the currently focused terminal tile. */
  terminalId: string | null;
  w: number;
  h: number;
  set: (terminalId: string, w: number, h: number) => void;
  clear: () => void;
}

export const useFocusTileSizeStore = create<FocusTileSizeStore>((set) => ({
  terminalId: null,
  w: 0,
  h: 0,
  set: (terminalId, w, h) => set({ terminalId, w, h }),
  clear: () => set({ terminalId: null, w: 0, h: 0 }),
}));
