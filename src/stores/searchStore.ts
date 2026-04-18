import { create } from "zustand";

export type SearchCategory =
  | "action"
  | "file"
  | "terminal"
  | "git-commit"
  | "git-branch"
  | "session"
  | "memory";

export type SearchResultData =
  | { type: "action"; actionId: string; perform: () => void }
  | { type: "file"; filePath: string }
  | { type: "terminal"; terminalId: string }
  | { type: "git-commit"; hash: string; worktreePath: string }
  | { type: "git-branch"; name: string; worktreePath: string }
  | { type: "session"; filePath: string }
  | { type: "memory"; fileName: string };

export interface SearchResult {
  id: string;
  category: SearchCategory;
  title: string;
  subtitle: string;
  score: number;
  data: SearchResultData;
}

/**
 * Scope of the session lookup, togglable with Tab inside the palette.
 *
 * - "current": restrict to the project that owns the currently-focused
 *   terminal tile. Matches the most common flow — "I remember asking
 *   Claude about X in this project, find it". If no terminal is
 *   focused, this falls back to "all" transparently (the palette's
 *   scope controller handles that, not the store).
 * - "all": every project currently on the canvas. Useful when you
 *   can't remember which project the session belonged to.
 */
export type SearchScope = "current" | "all";

interface SearchStore {
  open: boolean;
  query: string;
  results: SearchResult[];
  selectedIndex: number;
  loading: boolean;
  scope: SearchScope;

  openSearch: (scope?: SearchScope) => void;
  closeSearch: () => void;
  setQuery: (query: string) => void;
  setResults: (results: SearchResult[]) => void;
  setSelectedIndex: (index: number) => void;
  selectNext: () => void;
  selectPrev: () => void;
  setLoading: (loading: boolean) => void;
  toggleScope: () => void;
  setScope: (scope: SearchScope) => void;
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  open: false,
  query: "",
  results: [],
  selectedIndex: 0,
  loading: false,
  scope: "current",

  openSearch: (scope) =>
    set({
      open: true,
      query: "",
      results: [],
      selectedIndex: 0,
      loading: false,
      scope: scope ?? get().scope,
    }),
  closeSearch: () => set({ open: false }),
  setQuery: (query) => set({ query, selectedIndex: 0 }),
  setResults: (results) => {
    const { selectedIndex } = get();
    set({ results, selectedIndex: Math.min(selectedIndex, Math.max(0, results.length - 1)) });
  },
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  selectNext: () => {
    const { results, selectedIndex } = get();
    if (results.length === 0) return;
    set({ selectedIndex: (selectedIndex + 1) % results.length });
  },
  selectPrev: () => {
    const { results, selectedIndex } = get();
    if (results.length === 0) return;
    set({ selectedIndex: (selectedIndex - 1 + results.length) % results.length });
  },
  setLoading: (loading) => set({ loading }),
  toggleScope: () =>
    set((state) => ({
      scope: state.scope === "current" ? "all" : "current",
      // Scope change re-qualifies what's in `results`; clearing keeps
      // the list in sync with the new scope. The provider re-runs on
      // the next render tick via the palette's effect.
      results: [],
      selectedIndex: 0,
    })),
  setScope: (scope) =>
    set({ scope, results: [], selectedIndex: 0 }),
}));
