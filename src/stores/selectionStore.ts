import { create } from "zustand";

export type SelectedItem =
  | { type: "project"; projectId: string }
  | { type: "worktree"; projectId: string; worktreeId: string }
  | { type: "terminal"; projectId: string; worktreeId: string; terminalId: string }
  | { type: "card"; cardId: string };

interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SelectionStore {
  selectionRect: SelectionRect | null;
  selectedItems: SelectedItem[];
  setSelectionRect: (rect: SelectionRect | null) => void;
  setSelectedItems: (items: SelectedItem[]) => void;
  clearSelection: () => void;
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectionRect: null,
  selectedItems: [],
  setSelectionRect: (rect) => set({ selectionRect: rect }),
  setSelectedItems: (items) => set({ selectedItems: items }),
  clearSelection: () => set({ selectionRect: null, selectedItems: [] }),
}));
