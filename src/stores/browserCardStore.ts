import { create } from "zustand";
import { useWorkspaceStore } from "./workspaceStore";

export interface BrowserCardData {
  id: string;
  url: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BrowserCardStore {
  cards: Record<string, BrowserCardData>;
  addCard: (url: string, position?: { x: number; y: number }) => string;
  removeCard: (id: string) => void;
  updateCard: (id: string, patch: Partial<BrowserCardData>) => void;
}

let counter = 0;

function markDirty() {
  useWorkspaceStore.getState().markDirty();
}

export const useBrowserCardStore = create<BrowserCardStore>((set) => ({
  cards: {},

  addCard: (url, position) => {
    const id = `browser-${Date.now()}-${++counter}`;
    const card: BrowserCardData = {
      id,
      url,
      title: url,
      x: position?.x ?? window.innerWidth / 2 - 400,
      y: position?.y ?? window.innerHeight / 2 - 300,
      w: 800,
      h: 600,
    };
    set((state) => ({ cards: { ...state.cards, [id]: card } }));
    markDirty();
    return id;
  },

  removeCard: (id) => {
    let removed = false;
    set((state) => {
      if (!(id in state.cards)) return state;
      removed = true;
      const { [id]: _, ...rest } = state.cards;
      return { cards: rest };
    });
    if (removed) {
      markDirty();
    }
  },

  updateCard: (id, patch) => {
    let updated = false;
    set((state) => {
      const existing = state.cards[id];
      if (!existing) return state;
      updated = true;
      return { cards: { ...state.cards, [id]: { ...existing, ...patch } } };
    });
    if (updated) {
      markDirty();
    }
  },
}));
