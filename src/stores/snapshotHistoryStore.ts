import { create } from "zustand";

export interface SnapshotHistoryEntry {
  id: string;
  savedAt: number;
  terminalCount: number;
  projectCount: number;
  label?: string;
}

interface SnapshotHistoryStore {
  open: boolean;
  entries: SnapshotHistoryEntry[];
  selectedIndex: number;
  loading: boolean;
  pendingRestoreId: string | null;
  openHistory: () => void;
  closeHistory: () => void;
  toggleHistory: () => void;
  setSelectedIndex: (index: number) => void;
  selectNext: () => void;
  selectPrev: () => void;
  setEntries: (entries: SnapshotHistoryEntry[]) => void;
  upsertEntry: (entry: SnapshotHistoryEntry) => void;
  setLoading: (loading: boolean) => void;
  setPendingRestoreId: (id: string | null) => void;
  refresh: () => Promise<void>;
}

export const useSnapshotHistoryStore = create<SnapshotHistoryStore>(
  (set, get) => ({
    open: false,
    entries: [],
    selectedIndex: 0,
    loading: false,
    pendingRestoreId: null,

    openHistory: () => {
      set({ open: true, selectedIndex: 0, pendingRestoreId: null });
      void get().refresh();
    },
    closeHistory: () =>
      set({ open: false, pendingRestoreId: null, selectedIndex: 0 }),
    toggleHistory: () => {
      if (get().open) {
        get().closeHistory();
      } else {
        get().openHistory();
      }
    },

    setSelectedIndex: (index) => set({ selectedIndex: index }),
    selectNext: () => {
      const { entries, selectedIndex } = get();
      if (entries.length === 0) return;
      set({ selectedIndex: (selectedIndex + 1) % entries.length });
    },
    selectPrev: () => {
      const { entries, selectedIndex } = get();
      if (entries.length === 0) return;
      set({
        selectedIndex:
          (selectedIndex - 1 + entries.length) % entries.length,
      });
    },

    setEntries: (entries) => {
      const sorted = [...entries].sort((a, b) => b.savedAt - a.savedAt);
      set((state) => ({
        entries: sorted,
        selectedIndex: Math.min(state.selectedIndex, Math.max(0, sorted.length - 1)),
      }));
    },

    upsertEntry: (entry) => {
      set((state) => {
        const next = [
          entry,
          ...state.entries.filter((e) => e.id !== entry.id),
        ].sort((a, b) => b.savedAt - a.savedAt);
        return { entries: next };
      });
    },

    setLoading: (loading) => set({ loading }),
    setPendingRestoreId: (pendingRestoreId) => set({ pendingRestoreId }),

    refresh: async () => {
      if (!window.termcanvas?.snapshots) return;
      set({ loading: true });
      try {
        const list = await window.termcanvas.snapshots.list();
        get().setEntries(list);
      } catch (err) {
        console.error("[snapshotHistoryStore] failed to refresh entries:", err);
      } finally {
        set({ loading: false });
      }
    },
  }),
);
