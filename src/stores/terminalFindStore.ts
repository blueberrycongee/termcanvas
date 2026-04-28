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
  openFor: (terminalId: string, prefill?: string) => void;
  close: () => void;
  setQuery: (query: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  toggleCaseSensitive: () => void;
  toggleWholeWord: () => void;
  toggleUseRegex: () => void;
}

// Fallback colors for the addon's inline style + the overview-ruler marks
// on xterm's scrollbar. CSS in index.css (`.xterm-find-result-decoration`)
// overrides the cell decoration backgroundColor + outline for the actual
// in-terminal highlight, so these only show on the ruler and as a graceful
// fallback if the CSS isn't loaded.
const DECORATIONS = {
  matchBackground: "#7d5e2e",
  matchOverviewRuler: "#d4a24e",
  activeMatchBackground: "#d4a24e",
  activeMatchColorOverviewRuler: "#f5c56e",
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
): ISearchOptions {
  return {
    caseSensitive: state.caseSensitive,
    wholeWord: state.wholeWord,
    regex: state.useRegex,
    decorations: DECORATIONS,
  };
}

export const useTerminalFindStore = create<FindState & FindActions>(
  (set, get) => {
    function rerunSearch() {
      const state = get();
      if (!state.openTerminalId || !state.query) {
        if (state.openTerminalId) {
          clearForTerminal(state.openTerminalId);
          set({ resultIndex: -1, resultCount: 0 });
        }
        return;
      }
      const search = getTerminalRuntime(state.openTerminalId)?.searchAddon;
      search?.findNext(state.query, buildSearchOptions(state));
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

      openFor: (terminalId, prefill) => {
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
        // Pre-fill from caller-supplied selection (the click-button path
        // captures it before activation), falling back to a fresh read of
        // xterm's current selection (the Cmd+F path). Single-line only —
        // multi-line selections aren't useful as search needles.
        const rawSelection =
          prefill ?? runtime?.xterm?.getSelection() ?? "";
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
          search.findNext(initialQuery, buildSearchOptions(get()));
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
        rerunSearch();
      },

      findNext: () => {
        const { openTerminalId, query } = get();
        if (!openTerminalId || !query) return;
        const search = getTerminalRuntime(openTerminalId)?.searchAddon;
        search?.findNext(query, buildSearchOptions(get()));
      },

      findPrevious: () => {
        const { openTerminalId, query } = get();
        if (!openTerminalId || !query) return;
        const search = getTerminalRuntime(openTerminalId)?.searchAddon;
        search?.findPrevious(query, buildSearchOptions(get()));
      },

      toggleCaseSensitive: () => {
        set({ caseSensitive: !get().caseSensitive });
        rerunSearch();
      },

      toggleWholeWord: () => {
        set({ wholeWord: !get().wholeWord });
        rerunSearch();
      },

      toggleUseRegex: () => {
        set({ useRegex: !get().useRegex });
        rerunSearch();
      },
    };
  },
);
