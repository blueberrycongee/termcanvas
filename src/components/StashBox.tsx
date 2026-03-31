import { useCallback, useEffect, useRef, useState } from "react";
import { useStashStore } from "../stores/stashStore";
import { unstashTerminal } from "../stores/projectStore";
import { destroyTerminalRuntime, getTerminalRuntimePreviewAnsi } from "../terminal/terminalRuntimeStore";
import { TERMINAL_TYPE_CONFIG } from "../terminal/terminalTypeConfig";
import { useT } from "../i18n/useT";

function StashCard({ terminalId }: { terminalId: string }) {
  const t = useT();
  const entry = useStashStore((s) =>
    s.items.find((item) => item.terminal.id === terminalId),
  );

  if (!entry) return null;

  const { terminal } = entry;
  const config = TERMINAL_TYPE_CONFIG[terminal.type] ?? {
    color: "#888",
    label: terminal.type,
  };
  const preview = getTerminalRuntimePreviewAnsi(terminal.id) ?? "";
  const previewText =
    preview.trim().length > 0
      ? preview.slice(0, 200)
      : "No buffered output.";

  return (
    <div className="flex items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="text-[10px] font-medium"
            style={{ color: config.color, fontFamily: '"Geist Mono", monospace' }}
          >
            {config.label}
          </span>
          {terminal.customTitle && (
            <span
              className="text-[10px] text-[var(--text-secondary)] truncate"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {terminal.customTitle}
            </span>
          )}
        </div>
        <pre
          className="text-[10px] leading-4 text-[var(--text-faint)] truncate whitespace-pre-wrap max-h-[40px] overflow-hidden"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {previewText}
        </pre>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          className="px-2 py-0.5 text-[10px] rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
          style={{ fontFamily: '"Geist Mono", monospace' }}
          onClick={() => unstashTerminal(terminal.id)}
        >
          {t.stash_restore}
        </button>
        <button
          className="px-2 py-0.5 text-[10px] rounded border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--red)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
          style={{ fontFamily: '"Geist Mono", monospace' }}
          onClick={() => {
            useStashStore.getState().unstash(terminal.id);
            destroyTerminalRuntime(terminal.id);
          }}
        >
          {t.stash_destroy}
        </button>
      </div>
    </div>
  );
}

export function StashBox() {
  const t = useT();
  const items = useStashStore((s) => s.items);
  const [expanded, setExpanded] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClickAway = useCallback(
    (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!expanded) return;
    window.addEventListener("mousedown", handleClickAway);
    return () => window.removeEventListener("mousedown", handleClickAway);
  }, [expanded, handleClickAway]);

  useEffect(() => {
    const onDragStart = () => setDragActive(true);
    const onDragEnd = () => setDragActive(false);
    window.addEventListener("termcanvas:terminal-drag-active", onDragStart);
    window.addEventListener("termcanvas:terminal-drag-end", onDragEnd);
    return () => {
      window.removeEventListener("termcanvas:terminal-drag-active", onDragStart);
      window.removeEventListener("termcanvas:terminal-drag-end", onDragEnd);
    };
  }, []);

  const showButton = items.length > 0 || dragActive;
  if (!showButton) return null;

  return (
    <div ref={panelRef} className="fixed bottom-4 right-4 z-[90]" data-stash-drop-target>
      {expanded ? (
        <div className="w-72 max-h-80 flex flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span
              className="text-[11px] font-medium text-[var(--text-primary)]"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {t.stash_box}
            </span>
            <button
              className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-0.5"
              onClick={() => setExpanded(false)}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 flex flex-col gap-1.5">
            {items.length === 0 ? (
              <div className="text-center text-[11px] text-[var(--text-faint)] py-4">
                {t.stash_empty}
              </div>
            ) : (
              items.map((entry) => (
                <StashCard
                  key={entry.terminal.id}
                  terminalId={entry.terminal.id}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <button
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 shadow-lg transition-all duration-150 ${
            dragActive
              ? "border-[var(--accent)] bg-[var(--accent)]/20 scale-110"
              : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]"
          }`}
          onClick={() => setExpanded(true)}
          data-stash-drop-target
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 4h12v2H2zM3 6v6a1 1 0 001 1h8a1 1 0 001-1V6"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M6 9h4"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          <span
            className="text-[11px] font-medium text-[var(--text-secondary)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.stash_count(items.length)}
          </span>
        </button>
      )}
    </div>
  );
}
