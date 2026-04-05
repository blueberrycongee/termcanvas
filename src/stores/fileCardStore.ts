import { create } from "zustand";
import { useSelectionStore } from "./selectionStore";

export interface FileCardData {
  id: string;
  fileName: string;
  filePath: string;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FileCardStore {
  cards: Record<string, FileCardData>;
  addCard: (entry: {
    fileName: string;
    filePath: string;
    anchorX: number;
    anchorY: number;
  }) => string;
  clear: () => void;
  removeCard: (id: string) => void;
  updateCard: (id: string, patch: Partial<FileCardData>) => void;
}

let counter = 0;

export function fileCardId() {
  return `file-${Date.now()}-${++counter}`;
}

export const useFileCardStore = create<FileCardStore>((set) => ({
  cards: {},

  addCard: ({ fileName, filePath, anchorX, anchorY }) => {
    const id = fileCardId();
    const card: FileCardData = {
      id,
      fileName,
      filePath,
      anchorX,
      anchorY,
      x: anchorX + 16,
      y: anchorY,
      w: 500,
      h: 400,
    };
    set((state) => ({ cards: { ...state.cards, [id]: card } }));
    return id;
  },

  clear: () => {
    const cardIds = new Set(Object.keys(useFileCardStore.getState().cards));
    set({ cards: {} });
    if (cardIds.size > 0) {
      useSelectionStore.setState((state) => ({
        selectedItems: state.selectedItems.filter(
          (item) => item.type !== "card" || !cardIds.has(item.cardId),
        ),
      }));
    }
  },

  removeCard: (id) => {
    let removed = false;
    set((state) => {
      if (!(id in state.cards)) {
        return state;
      }
      removed = true;
      const { [id]: _, ...rest } = state.cards;
      return { cards: rest };
    });

    if (removed) {
      useSelectionStore.setState((state) => ({
        selectedItems: state.selectedItems.filter(
          (item) => item.type !== "card" || item.cardId !== id,
        ),
      }));
    }
  },

  updateCard: (id, patch) =>
    set((state) => {
      const existing = state.cards[id];
      if (!existing) {
        return state;
      }
      return { cards: { ...state.cards, [id]: { ...existing, ...patch } } };
    }),
}));
