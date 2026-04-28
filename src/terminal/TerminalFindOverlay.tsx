import { useEffect, useRef } from "react";
import {
  type FindCorner,
  useTerminalFindStore,
} from "../stores/terminalFindStore";
import { useT } from "../i18n/useT";

const CORNER_CLASSES: Record<FindCorner, string> = {
  tl: "top-2 left-2",
  tr: "top-2 right-2",
  br: "bottom-2 right-2",
  bl: "bottom-2 left-2",
};

interface Props {
  terminalId: string;
}

export function TerminalFindOverlay({ terminalId }: Props) {
  const t = useT();
  const openTerminalId = useTerminalFindStore((s) => s.openTerminalId);
  const query = useTerminalFindStore((s) => s.query);
  const resultIndex = useTerminalFindStore((s) => s.resultIndex);
  const resultCount = useTerminalFindStore((s) => s.resultCount);
  const corner = useTerminalFindStore((s) => s.corner);
  const setQuery = useTerminalFindStore((s) => s.setQuery);
  const findNext = useTerminalFindStore((s) => s.findNext);
  const findPrevious = useTerminalFindStore((s) => s.findPrevious);
  const close = useTerminalFindStore((s) => s.close);
  const cycleCorner = useTerminalFindStore((s) => s.cycleCorner);

  const focusNonce = useTerminalFindStore((s) => s.focusNonce);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const isOpen = openTerminalId === terminalId;

  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => {
      // If the user clicked back into the terminal (or anywhere outside the
      // overlay) before the rAF fired, don't steal focus back. Re-focus only
      // when nothing is focused or focus is already inside our overlay.
      const active = document.activeElement;
      const inOverlay =
        overlayRef.current !== null &&
        active instanceof Node &&
        overlayRef.current.contains(active);
      if (active && active !== document.body && !inOverlay) return;
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen, focusNonce]);

  if (!isOpen) return null;

  const counterText =
    query && resultCount > 0
      ? `${resultIndex + 1} / ${resultCount}`
      : query
        ? t.terminal_find_no_match
        : "";

  return (
    <div
      ref={overlayRef}
      className={`absolute ${CORNER_CLASSES[corner]} z-20 flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 shadow-lg`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{ minWidth: 260 }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={t.terminal_find_placeholder}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)]"
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
      <span
        className="shrink-0 text-[10px] text-[var(--text-faint)] tabular-nums"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        {counterText}
      </span>
      <button
        type="button"
        title={t.terminal_find_previous}
        className="shrink-0 rounded p-1 text-[var(--text-faint)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
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
        className="shrink-0 rounded p-1 text-[var(--text-faint)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
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
      <button
        type="button"
        title={t.terminal_find_move_corner}
        className="shrink-0 rounded p-1 text-[var(--text-faint)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
        onClick={cycleCorner}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <rect
            x="1.5"
            y="1.5"
            width="7"
            height="7"
            stroke="currentColor"
            strokeWidth="1.2"
            rx="1"
          />
          <circle cx="7.5" cy="2.5" r="1.2" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        title={t.terminal_find_close}
        className="shrink-0 rounded p-1 text-[var(--text-faint)] hover:bg-[var(--border)] hover:text-[var(--red)]"
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
