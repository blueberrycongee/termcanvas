import { useEffect, useRef } from "react";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";
import { DemoAnimation } from "./DemoAnimation";

const isMac = (window.termcanvas?.app.platform ?? "darwin") === "darwin";

interface Props {
  onClose: () => void;
  autoplay?: boolean;
}

export function WelcomePopup({ onClose, autoplay = false }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const shortcuts = useShortcutStore((s) => s.shortcuts);

  const formatted = {
    clearFocus: formatShortcut(shortcuts.clearFocus, isMac),
    nextTerminal: formatShortcut(shortcuts.nextTerminal, isMac),
    prevTerminal: formatShortcut(shortcuts.prevTerminal, isMac),
    addProject: formatShortcut(shortcuts.addProject, isMac),
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--scrim)]"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="rounded-md bg-[var(--bg)] overflow-hidden flex flex-col border border-[var(--border)] max-w-[800px] w-full mx-4 shadow-2xl"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        <div className="flex items-center gap-2 px-3 py-2 select-none shrink-0">
          <div
            className="w-[3px] h-3 rounded-full shrink-0"
            style={{ background: "var(--amber)", opacity: 0.7 }}
          />
          <span className="text-[11px] font-medium" style={{ color: "var(--cyan)" }}>demo</span>
          <span className="text-[11px] text-[var(--text-muted)] truncate flex-1">termcanvas</span>
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={onClose}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <DemoAnimation autoplay={autoplay} shortcuts={formatted} />
      </div>
    </div>
  );
}
