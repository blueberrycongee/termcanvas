import { useEffect, useRef } from "react";
import { useTerminalFindStore } from "../stores/terminalFindStore";
import { useT } from "../i18n/useT";

interface Props {
  terminalId: string;
}

export function TerminalFindOverlay({ terminalId }: Props) {
  const t = useT();
  const openTerminalId = useTerminalFindStore((s) => s.openTerminalId);
  const query = useTerminalFindStore((s) => s.query);
  const resultIndex = useTerminalFindStore((s) => s.resultIndex);
  const resultCount = useTerminalFindStore((s) => s.resultCount);
  const caseSensitive = useTerminalFindStore((s) => s.caseSensitive);
  const wholeWord = useTerminalFindStore((s) => s.wholeWord);
  const useRegex = useTerminalFindStore((s) => s.useRegex);
  const setQuery = useTerminalFindStore((s) => s.setQuery);
  const findNext = useTerminalFindStore((s) => s.findNext);
  const findPrevious = useTerminalFindStore((s) => s.findPrevious);
  const close = useTerminalFindStore((s) => s.close);
  const toggleCaseSensitive = useTerminalFindStore((s) => s.toggleCaseSensitive);
  const toggleWholeWord = useTerminalFindStore((s) => s.toggleWholeWord);
  const toggleUseRegex = useTerminalFindStore((s) => s.toggleUseRegex);

  const focusNonce = useTerminalFindStore((s) => s.focusNonce);
  const inputRef = useRef<HTMLInputElement>(null);
  const isOpen = openTerminalId === terminalId;

  // Focus the input on every open + every re-press of Cmd+F (focusNonce
  // bumps). We don't guard on document.activeElement here: when find opens
  // from a focused terminal, xterm's hidden helper textarea owns focus, and
  // skipping the steal would leave the input dead.
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, focusNonce]);

  // Window-level Esc capture so the overlay closes regardless of which
  // element currently owns focus. Without this, Esc only worked when the
  // input itself had focus — and after the user clicked into xterm to
  // re-anchor a selection, Esc would silently fall through.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const counterText =
    query && resultCount > 0
      ? `${resultIndex + 1} / ${resultCount}`
      : query
        ? t.terminal_find_no_match
        : "";

  const toggleClass = (active: boolean) =>
    `shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none transition-colors duration-100 ${
      active
        ? "bg-[color-mix(in_srgb,var(--amber)_28%,transparent)] text-[var(--amber)]"
        : "text-[var(--text-faint)] hover:bg-[var(--border)] hover:text-[var(--text-secondary)]"
    }`;

  const navIconClass =
    "shrink-0 rounded p-1 text-[var(--text-faint)] hover:bg-[var(--border)] hover:text-[var(--text-primary)] transition-colors duration-100";

  return (
    <div
      className="absolute top-2 right-2 z-20 flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-2 py-1 shadow-lg backdrop-blur-sm"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{ minWidth: 260, maxWidth: "calc(100% - 16px)" }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={t.terminal_find_placeholder}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="min-w-0 flex-1 bg-transparent py-1 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
        style={{ fontFamily: '"Geist Mono", monospace' }}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) findPrevious();
            else findNext();
          }
        }}
      />
      {counterText && (
        <span
          className="shrink-0 text-[10px] text-[var(--text-faint)] tabular-nums"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {counterText}
        </span>
      )}
      <div
        className="flex shrink-0 items-center gap-0.5 border-l border-[var(--border)] pl-1.5"
        aria-label="Match options"
      >
        <button
          type="button"
          title={t.terminal_find_case_sensitive}
          aria-pressed={caseSensitive}
          className={toggleClass(caseSensitive)}
          onClick={toggleCaseSensitive}
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          Aa
        </button>
        <button
          type="button"
          title={t.terminal_find_whole_word}
          aria-pressed={wholeWord}
          className={toggleClass(wholeWord)}
          onClick={toggleWholeWord}
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          W
        </button>
        <button
          type="button"
          title={t.terminal_find_regex}
          aria-pressed={useRegex}
          className={toggleClass(useRegex)}
          onClick={toggleUseRegex}
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          .*
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-l border-[var(--border)] pl-1.5">
        <button
          type="button"
          title={t.terminal_find_previous}
          className={navIconClass}
          onClick={findPrevious}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path
              d="M2.5 6.5L5 4l2.5 2.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          title={t.terminal_find_next}
          className={navIconClass}
          onClick={findNext}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path
              d="M2.5 3.5L5 6l2.5-2.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <button
        type="button"
        title={t.terminal_find_close}
        className="shrink-0 rounded p-1 text-[var(--text-faint)] transition-colors duration-100 hover:bg-[var(--border)] hover:text-[var(--red)]"
        onClick={close}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path
            d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
