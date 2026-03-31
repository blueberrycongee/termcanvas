import { create } from "zustand";
import type { StashedTerminal } from "../types/index.ts";

interface StashStore {
  items: StashedTerminal[];
  stash: (entry: StashedTerminal) => void;
  unstash: (terminalId: string) => StashedTerminal | null;
  clear: () => void;
  setItems: (items: StashedTerminal[]) => void;
}

export const useStashStore = create<StashStore>((set, get) => ({
  items: [],

  stash: (entry) => {
    set((state) => ({ items: [...state.items, entry] }));
  },

  unstash: (terminalId) => {
    const { items } = get();
    const entry = items.find((item) => item.terminal.id === terminalId);
    if (!entry) return null;
    set({ items: items.filter((item) => item.terminal.id !== terminalId) });
    return entry;
  },

  clear: () => {
    set({ items: [] });
  },

  setItems: (items) => {
    set({ items });
  },
}));
