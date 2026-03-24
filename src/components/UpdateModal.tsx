import { useCallback, useRef } from "react";
import { marked } from "marked";
import { useUpdaterStore } from "../stores/updaterStore";
import { useT } from "../i18n/useT";

interface Props {
  onClose: () => void;
}

export function UpdateModal({ onClose }: Props) {
  const t = useT();
  const { status, info, downloadPercent, errorMessage } = useUpdaterStore();
  const backdropRef = useRef<HTMLDivElement>(null);

  const handleInstall = useCallback(() => {
    useUpdaterStore.getState().requestRestartOnClose();
    onClose();
    window.termcanvas.app.requestClose();
  }, [onClose]);

  const handleRetry = useCallback(() => {
    useUpdaterStore.setState({ status: "checking", errorMessage: null });
    window.termcanvas.updater.check();
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  const notes = typeof info?.releaseNotes === "string" ? info.releaseNotes : "";
  const changelogHtml = notes
    ? (marked.parse(notes, { async: false }) as string)
    : "";

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-[480px] max-h-[80vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              {status === "ready" ? t.update_modal_title_ready : t.update_modal_title}
            </h2>
            {info && (
              <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                v{info.version}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Changelog */}
        {changelogHtml && (
          <div className="flex-1 min-h-0 overflow-auto px-5 py-4">
            <div
              className="prose prose-sm prose-invert max-w-none text-[13px] text-[var(--text-secondary)] [&_h1]:text-[15px] [&_h2]:text-[14px] [&_h3]:text-[13px] [&_h1]:text-[var(--text-primary)] [&_h2]:text-[var(--text-primary)] [&_h3]:text-[var(--text-primary)] [&_a]:text-[var(--accent)] [&_code]:text-[var(--accent)] [&_code]:bg-[var(--surface)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_ul]:pl-4 [&_li]:my-0.5"
              dangerouslySetInnerHTML={{ __html: changelogHtml }}
            />
          </div>
        )}

        {/* Progress bar — only during download */}
        {status === "downloading" && (
          <div className="px-5 py-2">
            <div className="h-1.5 rounded-full bg-[var(--surface)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                style={{ width: `${downloadPercent}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {t.update_modal_downloading(downloadPercent)}
            </p>
          </div>
        )}

        {/* Error message */}
        {status === "error" && (
          <div className="px-5 py-3">
            <p className="text-[12px] text-red-400">
              {errorMessage || t.update_modal_download_failed}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {t.update_modal_later}
          </button>
          {status === "error" && (
            <button
              onClick={handleRetry}
              className="px-4 py-1.5 text-[12px] font-medium text-white bg-[var(--accent)] rounded-lg hover:brightness-110 transition-all"
            >
              {t.update_modal_retry}
            </button>
          )}
          {status === "ready" && (
            <button
              onClick={handleInstall}
              className="px-4 py-1.5 text-[12px] font-medium text-white bg-[var(--accent)] rounded-lg hover:brightness-110 transition-all"
            >
              {t.update_modal_restart}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
