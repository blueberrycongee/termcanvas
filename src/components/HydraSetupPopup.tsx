import { useState, useRef, useCallback } from "react";
import { useT } from "../i18n/useT";

interface Props {
  status: "missing" | "outdated";
  projectName: string;
  onEnable: () => Promise<void>;
  onDismiss: () => void;
  onDismissForever: () => void;
}

export function HydraSetupPopup({ status, projectName, onEnable, onDismiss, onDismissForever }: Props) {
  const t = useT();
  const backdropRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const handleAction = useCallback(async () => {
    setBusy(true);
    try {
      await onEnable();
    } finally {
      setBusy(false);
    }
  }, [onEnable]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === backdropRef.current) onDismiss();
      }}
    >
      <div
        className="rounded-md bg-[var(--bg)] overflow-hidden flex flex-col border border-[var(--border)] max-w-[400px] w-full mx-4 shadow-2xl"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2 px-3 py-2 select-none shrink-0">
          <div className="w-[3px] h-3 rounded-full bg-[var(--accent)]/60 shrink-0" />
          <span
            className="text-[11px] font-medium"
            style={{ color: "var(--accent)" }}
          >
            hydra
          </span>
          <span className="text-[11px] text-[var(--text-muted)] truncate flex-1">
            {projectName}
          </span>
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onClick={onDismiss}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2 2L8 8M8 2L2 8"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-4 pb-4 pt-1">
          <div className="text-[13px] leading-relaxed mb-4">
            <span style={{ color: "var(--text-primary)" }}>
              {status === "outdated" ? t.hydra_popup_outdated : t.hydra_popup_missing}
            </span>
          </div>

          <div className="text-[11px] text-[var(--text-muted)] mb-4 leading-relaxed">
            {t.hydra_popup_desc}
          </div>

          <div className="flex items-center gap-2 justify-end">
            <button
              className="text-[11px] px-3 py-1.5 rounded-md text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
              onClick={onDismissForever}
            >
              {t.hydra_popup_dont_remind}
            </button>
            <button
              className="text-[11px] px-3 py-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
              onClick={onDismiss}
            >
              {t.hydra_popup_later}
            </button>
            <button
              className="text-[11px] px-3 py-1.5 rounded-md bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              onClick={handleAction}
              disabled={busy}
            >
              {busy ? "..." : status === "outdated" ? t.hydra_update : t.hydra_enable_action}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
