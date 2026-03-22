import { create } from "zustand";

interface WorkspaceStore {
  workspacePath: string | null;
  dirty: boolean;
  lastSavedAt: number | null;
  setWorkspacePath: (path: string | null) => void;
  markDirty: () => void;
  markClean: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspacePath: null,
  dirty: false,
  lastSavedAt: null,
  setWorkspacePath: (path) => set({ workspacePath: path }),
  markDirty: () => set({ dirty: true }),
  markClean: () => set({ dirty: false, lastSavedAt: Date.now() }),
}));
