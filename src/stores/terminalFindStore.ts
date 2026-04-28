import { create } from "zustand";
import type { ISearchOptions } from "@xterm/addon-search";
import { getTerminalRuntime } from "../terminal/terminalRuntimeStore";

interface FindState {
  openTerminalId: string | null;
  query: string;
  resultIndex: number;
  resultCount: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
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
  toggleCaseSensitive: () => void;
  toggleWholeWord: () => void;
  toggleUseRegex: () => void;
}

const DECORATIONS = {
  matchBackground: "#FFE082",
  matchBorder: "#FFE082",
  matchOverviewRuler: "#FFE082",
  activeMatchBackground: "#F2A57E",
  activeMatchBorder: "#F2A57E",
  activeMatchColorOverviewRuler: "#F2A57E",
} as const;

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

function buildSearchOptions(
  state: Pick<FindState, "caseSensitive" | "wholeWord" | "useRegex">,
  incremental: boolean,
): ISearchOptions {
  return {
    caseSensitive: state.caseSensitive,
    wholeWord: state.wholeWord,
    regex: state.useRegex,
    incremental,
    decorations: DECORATIONS,
  };
}

export const useTerminalFindStore = create<FindState & FindActions>(
  (set, get) => {
    function rerunSearch(opts: { incremental: boolean }) {
      const state = get();
      if (!state.openTerminalId || !state.query) {
        if (state.openTerminalId) {
          clearForTerminal(state.openTerminalId);
          set({ resultIndex: -1, resultCount: 0 });
        }
        return;
      }
      const search = getTerminalRuntime(state.openTerminalId)?.searchAddon;
      search?.findNext(state.query, buildSearchOptions(state, opts.incremental));
    }

    return {
      openTerminalId: null,
      query: "",
      resultIndex: -1,
      resultCount: 0,
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
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
          search.findNext(initialQuery, buildSearchOptions(get(), false));
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
        rerunSearch({ incremental: true });
      },

      findNext: () => {
        const { openTerminalId, query } = get();
        if (!openTerminalId || !query) return;
        const search = getTerminalRuntime(openTerminalId)?.searchAddon;
        search?.findNext(query, buildSearchOptions(get(), false));
      },

      findPrevious: () => {
        const { openTerminalId, query } = get();
        if (!openTerminalId || !query) return;
        const search = getTerminalRuntime(openTerminalId)?.searchAddon;
        search?.findPrevious(query, buildSearchOptions(get(), false));
      },

      toggleCaseSensitive: () => {
        set({ caseSensitive: !get().caseSensitive });
        rerunSearch({ incremental: true });
      },

      toggleWholeWord: () => {
        set({ wholeWord: !get().wholeWord });
        rerunSearch({ incremental: true });
      },

      toggleUseRegex: () => {
        set({ useRegex: !get().useRegex });
        rerunSearch({ incremental: true });
      },
    };
  },
);
