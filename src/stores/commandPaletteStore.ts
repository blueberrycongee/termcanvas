import { create } from "zustand";

interface CommandPaletteStore {
  open: boolean;
  query: string;
  selectedIndex: number;
  /**
   * The first time the palette opens in this session, results animate in
   * with a stagger. Subsequent opens render immediately so the user can
   * type-and-execute without waiting on entrance motion. Reset on reload.
   */
  hasOpenedOnce: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  setQuery: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  selectNext: (resultCount: number) => void;
  selectPrev: (resultCount: number) => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set, get) => ({
  open: false,
  query: "",
  selectedIndex: 0,
  hasOpenedOnce: false,

  openPalette: () =>
    set({
      open: true,
      query: "",
      selectedIndex: 0,
      hasOpenedOnce: get().hasOpenedOnce,
    }),
  closePalette: () =>
    set((state) => ({
      open: false,
      query: "",
      selectedIndex: 0,
      hasOpenedOnce: state.hasOpenedOnce || state.open,
    })),
  togglePalette: () => {
    if (get().open) {
      get().closePalette();
    } else {
      get().openPalette();
    }
  },
  setQuery: (query) => set({ query, selectedIndex: 0 }),
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  selectNext: (resultCount) => {
    if (resultCount <= 0) return;
    set((state) => ({
      selectedIndex: (state.selectedIndex + 1) % resultCount,
    }));
  },
  selectPrev: (resultCount) => {
    if (resultCount <= 0) return;
    set((state) => ({
      selectedIndex:
        (state.selectedIndex - 1 + resultCount) % resultCount,
    }));
  },
}));
