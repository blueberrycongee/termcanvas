import { useCallback, useEffect, useMemo, useRef } from "react";

import { useSearchStore, type SearchCategory, type SearchResult } from "../stores/searchStore";
import { useT } from "../i18n/useT";
import {
  collectSyncResults,
  collectSessionResults,
  collectAsyncResults,
} from "./SearchModal/searchProviders";
import { executeResult } from "./SearchModal/resultNavigation";
import { useProjectStore } from "../stores/projectStore";

const MONO_STYLE = { fontFamily: '"Geist Mono", monospace' } as const;

const CATEGORY_ORDER: SearchCategory[] = [
  "action",
  "terminal",
  "file",
  "git-branch",
  "git-commit",
  "session",
  "memory",
];

const CATEGORY_LABEL_KEYS: Record<SearchCategory, string> = {
  action: "search_category_actions",
  terminal: "search_category_terminals",
  file: "search_category_files",
  "git-branch": "search_category_git_branches",
  "git-commit": "search_category_git_commits",
  session: "search_category_sessions",
  memory: "search_category_memory",
};

const CATEGORY_ICONS: Record<SearchCategory, string> = {
  action: "A",
  terminal: "T",
  file: "F",
  "git-branch": "B",
  "git-commit": "C",
  session: "S",
  memory: "M",
};

function IconSearch({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3 3" />
    </svg>
  );
}

export function SearchModal() {
  const t = useT() as Record<string, unknown>;
  const { open, query, results, selectedIndex, loading, scope } = useSearchStore();
  const {
    closeSearch,
    setQuery,
    setResults,
    setSelectedIndex,
    selectNext,
    selectPrev,
    setLoading,
    toggleScope,
  } = useSearchStore();

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const asyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFocusRef = useRef<Element | null>(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      if (prevFocusRef.current instanceof HTMLElement) {
        prevFocusRef.current.focus();
      }
    }
  }, [open]);

  // Derive which project dirs the current scope covers. Recomputes
  // on scope flip because the session provider re-runs from the
  // effect below. "current" needs a focused terminal to make sense;
  // if none is focused we quietly fall back to "all" instead of
  // returning an empty list, which would hide all session results
  // and confuse the user. Focus is modelled as a boolean on each
  // terminal (not a top-level id), so we walk the tree to find it.
  const projectDirs = useMemo(() => {
    const { projects } = useProjectStore.getState();
    const allDirs = projects.flatMap((p) =>
      p.worktrees.map((w) => w.path),
    );
    if (scope === "all") return allDirs;
    for (const p of projects) {
      for (const w of p.worktrees) {
        if (w.terminals.some((term) => term.focused)) {
          return [w.path];
        }
      }
    }
    return allDirs;
  }, [scope, open]);

  const currentProjectLabel = useMemo(() => {
    if (scope === "all") {
      return (t.search_scope_all_label as string) ?? `All canvas (${projectDirs.length})`;
    }
    if (projectDirs.length === 1) {
      const segments = projectDirs[0].split(/[\\/]/).filter(Boolean);
      return segments[segments.length - 1] ?? projectDirs[0];
    }
    return (t.search_scope_all_label as string) ?? `All canvas (${projectDirs.length})`;
  }, [scope, projectDirs, t]);

  // Run search on query / scope change.
  //
  // Flicker-avoidance invariant: at most ONE setResults call per
  // keystroke in the fast path (Tier 1 + Tier 1b), and only after
  // BOTH are ready. Previously the effect fired `setResults(sync)`
  // synchronously and then `setResults([...sync, ...sessions])` in
  // the session IPC's microtask — React painted the intermediate
  // sync-only snapshot, the session rows blinked out and back in
  // every keystroke. Awaiting the session promise before the first
  // commit means the old-query results remain on screen until the
  // new merged list is fully built, which is both faster (no
  // double reconciliation) and stable-looking.
  //
  // The Tier 2 ripgrep path still uses a second setResults because
  // it genuinely adds new rows several hundred ms after the fast
  // path settles — that's a content append, not a replacement, and
  // doesn't cause a flicker because it only extends the list.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const runFastPath = async () => {
      const syncResults = collectSyncResults(query, t);
      // Session listing hits the mtime-keyed main-process cache;
      // typical latency is sub-ms once warm, 100–200 ms on first
      // open when the index builds. Either way the UI keeps the
      // previous query's results visible until this resolves.
      const sessionResults = await collectSessionResults(query, projectDirs);
      if (cancelled) return;

      const merged: SearchResult[] = [...syncResults];
      const seen = new Set(merged.map((r) => r.id));
      for (const r of sessionResults) {
        if (!seen.has(r.id)) {
          merged.push(r);
          seen.add(r.id);
        }
      }
      setResults(merged);
    };
    void runFastPath();

    // Tier 2 (async IPC, grep): only when user typed something
    // substantial. Debounced 300 ms after last keystroke. File
    // search is scoped to the first project in the current scope;
    // session content grep is global (the backend already handles
    // its own scoping). Merges additively so the fast-path results
    // stay put.
    if (asyncTimerRef.current) clearTimeout(asyncTimerRef.current);
    if (query.length >= 3) {
      setLoading(true);
      asyncTimerRef.current = setTimeout(async () => {
        const asyncResults = await collectAsyncResults(query, projectDirs);
        if (cancelled) return;
        if (asyncResults.length > 0) {
          const current = useSearchStore.getState().results;
          const existingIds = new Set(current.map((r) => r.id));
          const newResults = asyncResults.filter((r) => !existingIds.has(r.id));
          if (newResults.length > 0) {
            setResults([...current, ...newResults]);
          }
        }
        setLoading(false);
      }, 300);
    }

    return () => {
      cancelled = true;
      if (asyncTimerRef.current) clearTimeout(asyncTimerRef.current);
    };
  }, [query, open, scope, projectDirs]);

  // Scroll selected item into view
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const selected = container.querySelector("[data-selected='true']");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (composingRef.current) return;

      if (e.key === "Escape") {
        e.preventDefault();
        closeSearch();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectNext();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectPrev();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const result = results[selectedIndex];
        if (result) executeResult(result);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        // Tab flips scope between "this project" and "all canvas".
        // Deliberately not Shift+Tab distinction — only two modes,
        // one key is enough. The scope label in the footer reflects
        // the current state; pressing Tab again flips back.
        toggleScope();
        return;
      }
    },
    [closeSearch, selectNext, selectPrev, results, selectedIndex, toggleScope],
  );

  // Group results by category
  const grouped = useMemo(() => {
    const groups: Array<{ category: SearchCategory; items: SearchResult[] }> = [];
    const byCategory = new Map<SearchCategory, SearchResult[]>();

    for (const r of results) {
      if (!byCategory.has(r.category)) byCategory.set(r.category, []);
      byCategory.get(r.category)!.push(r);
    }

    for (const cat of CATEGORY_ORDER) {
      const items = byCategory.get(cat);
      if (items && items.length > 0) {
        groups.push({ category: cat, items });
      }
    }

    return groups;
  }, [results]);

  // Build a flat index for keyboard navigation
  const flatResults = useMemo(() => results, [results]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={(e) => {
        if (e.target === backdropRef.current) closeSearch();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-xl mx-4 overflow-hidden rounded-lg border shadow-2xl"
        style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
      >
        {/* Input */}
        <div
          className="flex items-center gap-2.5 border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span style={{ color: "var(--text-muted)" }}>
            <IconSearch />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            placeholder={(t.search_placeholder as string) ?? "Search everything..."}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
            style={MONO_STYLE}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <span
              className="h-3 w-3 shrink-0 animate-spin rounded-full border-2"
              style={{ borderColor: "var(--text-faint)", borderTopColor: "var(--accent)" }}
            />
          )}
          <kbd
            className="shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
            style={{ ...MONO_STYLE, borderColor: "var(--border)", color: "var(--text-faint)" }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-[50vh] overflow-auto">
          {grouped.length === 0 && query.trim() && !loading ? (
            <div
              className="px-4 py-8 text-center text-[12px]"
              style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
            >
              {(t.search_no_results as string) ?? "No results found"}
            </div>
          ) : (
            grouped.map(({ category, items }) => (
              <div key={category}>
                <div
                  className="sticky top-0 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{
                    ...MONO_STYLE,
                    color: "var(--text-muted)",
                    backgroundColor: "var(--bg)",
                  }}
                >
                  {(t[CATEGORY_LABEL_KEYS[category]] as string) ?? category}
                </div>
                {items.map((result) => {
                  const globalIdx = flatResults.indexOf(result);
                  const isSelected = globalIdx === selectedIndex;

                  return (
                    <button
                      key={result.id}
                      data-selected={isSelected}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors duration-75"
                      style={{
                        backgroundColor: isSelected
                          ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                          : undefined,
                      }}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                      onClick={() => executeResult(result)}
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold"
                        style={{
                          ...MONO_STYLE,
                          color: isSelected ? "var(--accent)" : "var(--text-muted)",
                          backgroundColor: "color-mix(in srgb, var(--text-muted) 10%, transparent)",
                        }}
                      >
                        {CATEGORY_ICONS[category]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-[12px]"
                          style={{ ...MONO_STYLE, color: "var(--text-primary)" }}
                        >
                          {result.title}
                        </div>
                        {result.subtitle && (
                          <div
                            className="truncate text-[10px]"
                            style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
                          >
                            {result.subtitle}
                          </div>
                        )}
                      </div>
                      {isSelected && (
                        <span
                          className="shrink-0 text-[10px]"
                          style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
                        >
                          Enter
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {!query.trim() && results.length === 0 && !loading && (
            <div
              className="px-4 py-8 text-center text-[12px]"
              style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
            >
              {(t.search_empty_hint as string) ??
                "Type to find a past session, a terminal, a branch, or an action."}
            </div>
          )}
        </div>

        {/* Footer: scope indicator + key hints.
            One-line affordance that teaches Tab without a tutorial.
            The scope badge is left-weighted so it reads as a filter
            applied to the search above it; the keybind hints are
            right-aligned and compact. Matches the footer convention
            used by Linear / Superhuman / Raycast Cmd+K. */}
        <div
          className="flex items-center justify-between border-t px-3 py-2 text-[10px]"
          style={{ ...MONO_STYLE, borderColor: "var(--border)", color: "var(--text-faint)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-5 items-center rounded-md border px-2 text-[10px]"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              <span
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: scope === "current" ? "var(--accent)" : "var(--text-muted)" }}
              />
              {currentProjectLabel}
            </span>
            <span className="hidden sm:inline">
              <kbd
                className="rounded border px-1 py-0.5"
                style={{ borderColor: "var(--border)" }}
              >
                Tab
              </kbd>
              <span className="ml-1">
                {(t.search_footer_toggle_scope as string) ?? "toggle scope"}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>
              <kbd
                className="rounded border px-1 py-0.5"
                style={{ borderColor: "var(--border)" }}
              >
                ↵
              </kbd>
              <span className="ml-1">
                {(t.search_footer_open as string) ?? "open"}
              </span>
            </span>
            <span>
              <kbd
                className="rounded border px-1 py-0.5"
                style={{ borderColor: "var(--border)" }}
              >
                ↑↓
              </kbd>
              <span className="ml-1">
                {(t.search_footer_navigate as string) ?? "navigate"}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
