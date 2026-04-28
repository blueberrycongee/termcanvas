import { useCallback, useEffect, useMemo, useRef } from "react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import {
  useSearchStore,
  type SearchCategory,
  type SearchResult,
  type SearchScope,
} from "../stores/searchStore";
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

// Single-letter section glyphs. Mirrors CommandPalette.SECTION_GLYPH so the
// two surfaces share a visual idiom — same chip shape and weight, different
// letter. The eyebrow header above each group carries the semantic label;
// the chip just keeps row alignment consistent at scan-speed.
const CATEGORY_GLYPHS: Record<SearchCategory, string> = {
  action: "A",
  terminal: "T",
  file: "F",
  "git-branch": "B",
  "git-commit": "C",
  session: "S",
  memory: "M",
};

function IconSearch({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3 3" />
    </svg>
  );
}

export function SearchModal() {
  const t = useT() as Record<string, unknown>;
  const { open, query, results, selectedIndex, loading, scope } =
    useSearchStore();
  useBodyScrollLock(open);
  const {
    closeSearch,
    setQuery,
    setResults,
    setSelectedIndex,
    selectNext,
    selectPrev,
    setLoading,
    toggleScope,
    setScope,
  } = useSearchStore();

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const asyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (prevFocusRef.current instanceof HTMLElement) {
      prevFocusRef.current.focus();
    }
  }, [open]);

  // Resolve the current scope to a list of project paths. "current" maps
  // to the focused terminal's worktree; if no terminal is focused we fall
  // back to "all" silently rather than returning [] (which would hide
  // session results entirely and look like a bug).
  const projectDirs = useMemo(() => {
    const { projects } = useProjectStore.getState();
    const allDirs = projects.flatMap((p) => p.worktrees.map((w) => w.path));
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

  const currentProjectName = useMemo(() => {
    if (scope !== "current" || projectDirs.length !== 1) return null;
    const segments = projectDirs[0].split(/[\\/]/).filter(Boolean);
    return segments[segments.length - 1] ?? projectDirs[0];
  }, [scope, projectDirs]);

  const totalProjectCount = useMemo(() => {
    const { projects } = useProjectStore.getState();
    return projects.reduce((acc, p) => acc + p.worktrees.length, 0);
  }, [open]);

  // Tier 1 (sync) + Tier 1b (sessions) commit together to avoid a
  // sync-only flash before the session list resolves. Tier 2 (ripgrep)
  // appends additively several hundred ms later — see commit history
  // for the full invariant rationale; this effect is unchanged.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const runFastPath = async () => {
      const syncResults = collectSyncResults(query, t);
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

  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const selected = container.querySelector("[data-selected='true']");
    if (selected) selected.scrollIntoView({ block: "nearest" });
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
        toggleScope();
        return;
      }
    },
    [closeSearch, selectNext, selectPrev, results, selectedIndex, toggleScope],
  );

  const grouped = useMemo(() => {
    const groups: Array<{ category: SearchCategory; items: SearchResult[] }> =
      [];
    const byCategory = new Map<SearchCategory, SearchResult[]>();
    for (const r of results) {
      if (!byCategory.has(r.category)) byCategory.set(r.category, []);
      byCategory.get(r.category)!.push(r);
    }
    for (const cat of CATEGORY_ORDER) {
      const items = byCategory.get(cat);
      if (items && items.length > 0) groups.push({ category: cat, items });
    }
    return groups;
  }, [results]);

  const matchCountLabel = useMemo(() => {
    if (results.length === 0) return null;
    if (results.length === 1) {
      return (t.search_footer_match_one as string) ?? "1 match";
    }
    const fn = t.search_footer_match_many;
    if (typeof fn === "function") {
      return (fn as (n: number) => string)(results.length);
    }
    return `${results.length} matches`;
  }, [results.length, t]);

  if (!open) return null;

  // Scope chip — visible affordance for what was previously a hidden Tab
  // toggle. mousedown.preventDefault() keeps focus on the search input so
  // the user's typing flow is uninterrupted; click flips scope.
  const renderScopeChip = (target: SearchScope, label: string) => {
    const active = scope === target;
    return (
      <button
        key={target}
        type="button"
        role="tab"
        aria-selected={active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setScope(target)}
        className="inline-flex h-6 items-center rounded-full border px-2.5 text-[11px]"
        style={{
          ...MONO_STYLE,
          color: active ? "var(--accent)" : "var(--text-secondary)",
          backgroundColor: active ? "var(--accent-soft)" : "transparent",
          borderColor: active
            ? "color-mix(in srgb, var(--accent) 35%, transparent)"
            : "var(--border)",
          transition:
            "color var(--duration-quick) var(--ease-out-soft), background-color var(--duration-quick) var(--ease-out-soft), border-color var(--duration-quick) var(--ease-out-soft)",
        }}
      >
        {label}
      </button>
    );
  };

  const renderRow = (result: SearchResult, globalIdx: number) => {
    const isSelected = globalIdx === selectedIndex;
    return (
      <button
        key={result.id}
        data-selected={isSelected}
        type="button"
        className="tc-cmd-row flex w-full items-center gap-3 px-4 py-2 text-left"
        style={{
          backgroundColor: isSelected
            ? "color-mix(in srgb, var(--accent) 12%, transparent)"
            : undefined,
        }}
        onMouseEnter={() => setSelectedIndex(globalIdx)}
        onClick={() => executeResult(result)}
      >
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold"
          style={{
            ...MONO_STYLE,
            color: isSelected ? "var(--accent)" : "var(--text-muted)",
            backgroundColor: isSelected
              ? "color-mix(in srgb, var(--accent) 16%, transparent)"
              : "color-mix(in srgb, var(--text-muted) 10%, transparent)",
            transition:
              "color var(--duration-quick) var(--ease-out-soft), background-color var(--duration-quick) var(--ease-out-soft)",
          }}
        >
          {CATEGORY_GLYPHS[result.category]}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[13px]"
            style={{
              color: "var(--text-primary)",
              fontWeight: isSelected ? 500 : 400,
            }}
          >
            {result.title}
          </div>
          {result.subtitle && (
            <div
              className="truncate text-[11px]"
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
  };

  const trimmedQuery = query.trim();
  const showSearching =
    loading && grouped.length === 0 && trimmedQuery.length >= 3;
  const showNoResults =
    !loading && grouped.length === 0 && trimmedQuery.length > 0;
  const showEmptyHint = !trimmedQuery && results.length === 0 && !loading;

  // Right-side context line for the scope row. Tells the user *which*
  // project "this project" resolves to, or how many worktrees fall under
  // "all canvas" — turns the abstract scope label into a concrete claim.
  const scopeContextLabel =
    scope === "current" && currentProjectName
      ? currentProjectName
      : scope === "all"
        ? `${totalProjectCount} ${totalProjectCount === 1 ? "worktree" : "worktrees"}`
        : null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      style={{ backgroundColor: "var(--scrim)" }}
      onClick={(e) => {
        if (e.target === backdropRef.current) closeSearch();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="tc-enter-fade-up w-full max-w-xl mx-4 overflow-hidden rounded-lg border shadow-2xl"
        style={{
          backgroundColor: "var(--bg)",
          borderColor: "var(--border)",
        }}
      >
        {/* Input */}
        <div
          className="flex items-center gap-2.5 border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span style={{ color: "var(--text-secondary)" }}>
            <IconSearch />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            placeholder={
              (t.search_placeholder_browse as string) ??
              "Type to filter, or browse recent sessions below"
            }
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
            style={MONO_STYLE}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <span
              className="h-3 w-3 shrink-0 animate-spin rounded-full border-2"
              style={{
                borderColor: "var(--text-faint)",
                borderTopColor: "var(--accent)",
              }}
            />
          )}
          <kbd
            className="shrink-0 rounded border px-1.5 py-0.5 text-[10px]"
            style={{
              ...MONO_STYLE,
              borderColor: "var(--border)",
              color: "var(--text-faint)",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Scope chip row — the IA differentiator from CommandPalette.
            Hoists the previously hidden Tab-only scope toggle into a
            visible filter, reading "what I'm typing → where I'm searching
            → what I'm finding" top to bottom. The right-side label
            resolves the abstract scope into a concrete project name or
            worktree count so the user never has to guess what "this
            project" is right now. */}
        <div
          role="tablist"
          aria-label={(t.search_scope_aria_label as string) ?? "Search scope"}
          className="flex items-center gap-1.5 border-b px-3 py-2"
          style={{ borderColor: "var(--border)" }}
        >
          {renderScopeChip(
            "current",
            (t.search_scope_chip_current as string) ?? "This project",
          )}
          {renderScopeChip(
            "all",
            (t.search_scope_chip_all as string) ?? "All canvas",
          )}
          {scopeContextLabel && (
            <span
              className="ml-auto truncate pl-2 text-[11px]"
              style={{ ...MONO_STYLE, color: "var(--text-metadata)" }}
            >
              {scopeContextLabel}
            </span>
          )}
        </div>

        {/* Results */}
        <div ref={resultsRef} className="max-h-[50vh] overflow-auto">
          {showSearching ? (
            <div
              className="px-4 py-10 text-center text-[12px]"
              style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
            >
              {(t.search_searching_ellipsis as string) ?? "Searching…"}
            </div>
          ) : showNoResults ? (
            <div
              className="px-4 py-10 text-center text-[12px]"
              style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
            >
              {(t.search_no_results as string) ?? "No results found"}
            </div>
          ) : showEmptyHint ? (
            <div
              className="px-4 py-10 text-center text-[12px]"
              style={{ ...MONO_STYLE, color: "var(--text-faint)" }}
            >
              {(t.search_empty_hint as string) ??
                "Type to find a past session, a terminal, a branch, or an action."}
            </div>
          ) : (
            grouped.map(({ category, items }) => (
              <div key={category}>
                <div
                  className="sticky top-0 px-4 py-1.5 text-[10px] font-medium uppercase"
                  style={{
                    ...MONO_STYLE,
                    color: "var(--text-muted)",
                    backgroundColor: "var(--bg)",
                    letterSpacing: "var(--tracking-eyebrow)",
                  }}
                >
                  {category === "session" && !trimmedQuery
                    ? ((t.search_category_sessions_recent as string) ??
                      "Recent sessions")
                    : ((t[CATEGORY_LABEL_KEYS[category]] as string) ??
                      category)}
                </div>
                {items.map((result) =>
                  renderRow(result, results.indexOf(result)),
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-3 py-2 text-[10px]"
          style={{
            ...MONO_STYLE,
            borderColor: "var(--border)",
            color: "var(--text-faint)",
          }}
        >
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
          {matchCountLabel && (
            <span className="hidden sm:inline">{matchCountLabel}</span>
          )}
        </div>
      </div>
    </div>
  );
}
