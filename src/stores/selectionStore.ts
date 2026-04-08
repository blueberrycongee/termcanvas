import { create } from "zustand";

export type SelectedItem =
  | { type: "project"; projectId: string }
  | { type: "worktree"; projectId: string; worktreeId: string }
  | { type: "terminal"; projectId: string; worktreeId: string; terminalId: string }
  | { type: "card"; cardId: string }
  | { type: "annotation"; annotationId: string };

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
  selectAnnotation: (annotationId: string) => void;
  selectCard: (cardId: string) => void;
  selectProject: (projectId: string) => void;
  selectTerminal: (
    projectId: string,
    worktreeId: string,
    terminalId: string,
  ) => void;
  selectWorktree: (projectId: string, worktreeId: string) => void;
  clearSelection: () => void;
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectionRect: null,
  selectedItems: [],
  setSelectionRect: (rect) => set({ selectionRect: rect }),
  setSelectedItems: (items) => set({ selectedItems: items }),
  selectAnnotation: (annotationId) =>
    set({
      selectedItems: [{ type: "annotation", annotationId }],
      selectionRect: null,
    }),
  selectCard: (cardId) =>
    set({
      selectedItems: [{ type: "card", cardId }],
      selectionRect: null,
    }),
  selectProject: (projectId) =>
    set({
      selectedItems: [{ type: "project", projectId }],
      selectionRect: null,
    }),
  selectTerminal: (projectId, worktreeId, terminalId) =>
    set({
      selectedItems: [{ type: "terminal", projectId, worktreeId, terminalId }],
      selectionRect: null,
    }),
  selectWorktree: (projectId, worktreeId) =>
    set({
      selectedItems: [{ type: "worktree", projectId, worktreeId }],
      selectionRect: null,
    }),
  clearSelection: () => set({ selectionRect: null, selectedItems: [] }),
}));
