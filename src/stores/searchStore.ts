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

interface SearchStore {
  open: boolean;
  query: string;
  results: SearchResult[];
  selectedIndex: number;
  loading: boolean;

  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (query: string) => void;
  setResults: (results: SearchResult[]) => void;
  setSelectedIndex: (index: number) => void;
  selectNext: () => void;
  selectPrev: () => void;
  setLoading: (loading: boolean) => void;
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  open: false,
  query: "",
  results: [],
  selectedIndex: 0,
  loading: false,

  openSearch: () => set({ open: true, query: "", results: [], selectedIndex: 0, loading: false }),
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
}));
