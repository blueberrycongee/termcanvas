import { create } from "zustand";
import type { ISearchOptions, SearchAddon } from "@xterm/addon-search";
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
  matchBackground: "#1f6f69",
  matchOverviewRuler: "#6cc4b0",
  activeMatchBackground: "#2dd4bf",
  activeMatchColorOverviewRuler: "#9be7d5",
} as const;

let detachResultsListener: (() => void) | null = null;
let resultsListenerTarget:
  | { terminalId: string; searchAddon: SearchAddon }
  | null = null;
let lastFindSelection:
  | { terminalId: string; text: string }
  | null = null;

function teardownListener() {
  detachResultsListener?.();
  detachResultsListener = null;
  resultsListenerTarget = null;
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

function normalizeSelection(selection: string): string {
  return selection.includes("\n") || selection.trim() === "" ? "" : selection;
}

function selectionMatchesQuery(
  selection: string,
  query: string,
  state: Pick<FindState, "caseSensitive" | "useRegex">,
): boolean {
  if (!selection || !query || state.useRegex) return false;
  return state.caseSensitive
    ? selection === query
    : selection.toLocaleLowerCase() === query.toLocaleLowerCase();
}

export const useTerminalFindStore = create<FindState & FindActions>(
  (set, get) => {
    function ensureResultsListener(terminalId: string): SearchAddon | null {
      const search = getTerminalRuntime(terminalId)?.searchAddon ?? null;
      if (!search) {
        if (resultsListenerTarget?.terminalId === terminalId) {
          teardownListener();
        }
        return null;
      }

      if (
        resultsListenerTarget?.terminalId === terminalId &&
        resultsListenerTarget.searchAddon === search
      ) {
        return search;
      }

      teardownListener();
      const disp = search.onDidChangeResults(
        ({ resultIndex, resultCount }) => {
          if (get().openTerminalId !== terminalId) return;
          set({ resultIndex, resultCount });
        },
      );
      detachResultsListener = () => disp.dispose();
      resultsListenerTarget = { terminalId, searchAddon: search };
      return search;
    }

    function rememberFindSelection(terminalId: string, found: boolean) {
      if (!found) {
        lastFindSelection = null;
        return;
      }
      const text = getTerminalRuntime(terminalId)?.xterm?.getSelection() ?? "";
      lastFindSelection = text ? { terminalId, text } : null;
    }

    function runSearch(
      terminalId: string,
      query: string,
      direction: "next" | "previous" = "next",
      options: { restartFromFirst?: boolean } = {},
    ) {
      const runtime = getTerminalRuntime(terminalId);
      const search = ensureResultsListener(terminalId);
      if (!search) {
        set({ resultIndex: -1, resultCount: 0 });
        lastFindSelection = null;
        return;
      }

      if (options.restartFromFirst) {
        search.clearDecorations();
        runtime?.xterm?.clearSelection();
        lastFindSelection = null;
      }

      const found =
        direction === "previous"
          ? search.findPrevious(query, buildSearchOptions(get()))
          : search.findNext(query, buildSearchOptions(get()));
      rememberFindSelection(terminalId, found);
    }

    function rerunSearch(options: { restartFromFirst?: boolean } = {}) {
      const state = get();
      if (!state.openTerminalId || !state.query) {
        if (state.openTerminalId) {
          clearForTerminal(state.openTerminalId);
          set({ resultIndex: -1, resultCount: 0 });
        }
        lastFindSelection = null;
        return;
      }
      runSearch(state.openTerminalId, state.query, "next", options);
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
        const state = get();
        const { openTerminalId: prev, focusNonce } = state;
        const runtime = getTerminalRuntime(terminalId);
        const initialQuery = normalizeSelection(
          prefill ?? runtime?.xterm?.getSelection() ?? "",
        );

        // Re-press on the same terminal: keep query/results, just nudge the
        // overlay to re-focus + select the input. If the user has selected a
        // different xterm range while find is open, adopt that selection like
        // VS Code/Ghostty do.
        if (prev === terminalId) {
          set({ focusNonce: focusNonce + 1 });
          if (
            initialQuery &&
            !selectionMatchesQuery(initialQuery, state.query, state) &&
            !(
              lastFindSelection?.terminalId === terminalId &&
              lastFindSelection.text === initialQuery
            )
          ) {
            set({
              query: initialQuery,
              resultIndex: -1,
              resultCount: 0,
            });
            runSearch(terminalId, initialQuery);
          }
          return;
        }

        teardownListener();
        if (prev) clearForTerminal(prev);

        // Pre-fill from caller-supplied selection (the click-button path
        // captures it before activation), falling back to a fresh read of
        // xterm's current selection (the Cmd+F path). Single-line only —
        // multi-line selections aren't useful as search needles.
        set({
          openTerminalId: terminalId,
          query: initialQuery,
          resultIndex: -1,
          resultCount: 0,
          focusNonce: focusNonce + 1,
        });

        if (initialQuery) {
          runSearch(terminalId, initialQuery);
        } else {
          ensureResultsListener(terminalId);
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
        lastFindSelection = null;
      },

      setQuery: (query) => {
        set({ query });
        rerunSearch();
      },

      findNext: () => {
        const { openTerminalId, query } = get();
        if (!openTerminalId || !query) return;
        runSearch(openTerminalId, query);
      },

      findPrevious: () => {
        const { openTerminalId, query } = get();
        if (!openTerminalId || !query) return;
        runSearch(openTerminalId, query, "previous");
      },

      toggleCaseSensitive: () => {
        set({ caseSensitive: !get().caseSensitive });
        rerunSearch({ restartFromFirst: true });
      },

      toggleWholeWord: () => {
        set({ wholeWord: !get().wholeWord });
        rerunSearch({ restartFromFirst: true });
      },

      toggleUseRegex: () => {
        set({ useRegex: !get().useRegex });
        rerunSearch({ restartFromFirst: true });
      },
    };
  },
);
