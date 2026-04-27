import { create } from "zustand";

interface CanvasManagerStore {
  open: boolean;
  /**
   * When set, the modal opens directly into rename mode for that canvas
   * id. Cleared on close.
   */
  renameTargetId: string | null;
  openManager: () => void;
  openRename: (canvasId: string) => void;
  close: () => void;
}

export const useCanvasManagerStore = create<CanvasManagerStore>((set) => ({
  open: false,
  renameTargetId: null,
  openManager: () => set({ open: true, renameTargetId: null }),
  openRename: (canvasId) => set({ open: true, renameTargetId: canvasId }),
  close: () => set({ open: false, renameTargetId: null }),
}));
