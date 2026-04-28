import { create } from "zustand";
import type { ISearchOptions } from "@xterm/addon-search";
import { getTerminalRuntime } from "../terminal/terminalRuntimeStore";

export type FindCorner = "tl" | "tr" | "br" | "bl";

interface FindState {
  openTerminalId: string | null;
  query: string;
  resultIndex: number;
  resultCount: number;
  corner: FindCorner;
  // Bumped each time the user invokes the open shortcut so the overlay can
  // re-focus + select-all even when the overlay is already mounted on the
  // same terminal (Cmd+F → Cmd+F should preserve the query).
  focusNonce: number;
}

interface FindActions {
  openFor: (terminalId: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  cycleCorner: () => void;
}

const SEARCH_DECORATIONS: ISearchOptions = {
  decorations: {
    matchBackground: "#FFE082",
    matchBorder: "#FFE082",
    matchOverviewRuler: "#FFE082",
    activeMatchBackground: "#F2A57E",
    activeMatchBorder: "#F2A57E",
    activeMatchColorOverviewRuler: "#F2A57E",
  },
};

const INCREMENTAL_OPTS: ISearchOptions = {
  ...SEARCH_DECORATIONS,
  incremental: true,
};

const CORNER_CYCLE: FindCorner[] = ["tr", "br", "bl", "tl"];

let detachResultsListener: (() => void) | null = null;

function teardownListener() {
  detachResultsListener?.();
  detachResultsListener = null;
}

function clearForTerminal(terminalId: string | null) {
  if (!terminalId) return;
  const search = getTerminalRuntime(terminalId)?.searchAddon;
  search?.clearDecorations();
}

export const useTerminalFindStore = create<FindState & FindActions>(
  (set, get) => ({
    openTerminalId: null,
    query: "",
    resultIndex: -1,
    resultCount: 0,
    corner: "tr",
    focusNonce: 0,

    openFor: (terminalId) => {
      const { openTerminalId: prev, focusNonce } = get();
      // Re-press on the same terminal: keep query/results, just nudge the
      // overlay to re-focus + select the input.
      if (prev === terminalId) {
        set({ focusNonce: focusNonce + 1 });
        return;
      }

      teardownListener();
      if (prev) clearForTerminal(prev);

      const runtime = getTerminalRuntime(terminalId);
      const search = runtime?.searchAddon;
      // Pre-fill from current xterm selection (single-line only — Ghostty's
      // rule). Replaces the macOS "Use Selection for Find" Cmd+E flow.
      const rawSelection = runtime?.xterm?.getSelection() ?? "";
      const initialQuery =
        rawSelection.includes("\n") || rawSelection.trim() === ""
          ? ""
          : rawSelection;

      set({
        openTerminalId: terminalId,
        query: initialQuery,
        resultIndex: -1,
        resultCount: 0,
        focusNonce: focusNonce + 1,
      });

      if (!search) return;

      const disp = search.onDidChangeResults(
        ({ resultIndex, resultCount }) => {
          set({ resultIndex, resultCount });
        },
      );
      detachResultsListener = () => disp.dispose();

      if (initialQuery) {
        search.findNext(initialQuery, SEARCH_DECORATIONS);
      }
    },

    close: () => {
      teardownListener();
      const { openTerminalId } = get();
      clearForTerminal(openTerminalId);
      set({
        openTerminalId: null,
        query: "",
        resultIndex: -1,
        resultCount: 0,
      });
    },

    setQuery: (query) => {
      set({ query });
      const { openTerminalId } = get();
      if (!openTerminalId) return;

      const search = getTerminalRuntime(openTerminalId)?.searchAddon;
      if (!search) return;

      if (query) {
        // Incremental: re-highlight without scrolling past the current match
        // until the user explicitly hits Enter.
        search.findNext(query, INCREMENTAL_OPTS);
      } else {
        search.clearDecorations();
        set({ resultIndex: -1, resultCount: 0 });
      }
    },

    findNext: () => {
      const { openTerminalId, query } = get();
      if (!openTerminalId || !query) return;
      const search = getTerminalRuntime(openTerminalId)?.searchAddon;
      search?.findNext(query, SEARCH_DECORATIONS);
    },

    findPrevious: () => {
      const { openTerminalId, query } = get();
      if (!openTerminalId || !query) return;
      const search = getTerminalRuntime(openTerminalId)?.searchAddon;
      search?.findPrevious(query, SEARCH_DECORATIONS);
    },

    cycleCorner: () => {
      const { corner } = get();
      const idx = CORNER_CYCLE.indexOf(corner);
      const next = CORNER_CYCLE[(idx + 1) % CORNER_CYCLE.length];
      set({ corner: next });
    },
  }),
);
