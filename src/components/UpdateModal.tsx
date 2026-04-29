import { useCallback, useRef } from "react";
import { marked } from "marked";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useUpdaterStore } from "../stores/updaterStore";
import { useT } from "../i18n/useT";
import { useLocaleStore } from "../stores/localeStore";

interface Props {
  onClose: () => void;
}

function extractLocalizedNotes(notes: string, locale: string): string {
  const zhMatch = notes.match(/<!--\s*zh\s*-->([\s\S]*?)<!--\s*\/zh\s*-->/);
  if (locale === "zh" && zhMatch) return zhMatch[1].trim();
  // Strip zh block to get English content
  return notes.replace(/<!--\s*zh\s*-->[\s\S]*?<!--\s*\/zh\s*-->/g, "").trim();
}

export function UpdateModal({ onClose }: Props) {
  useBodyScrollLock(true);
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const { status, info, downloadPercent, errorMessage } = useUpdaterStore();
  const backdropRef = useRef<HTMLDivElement>(null);

  const handleInstall = useCallback(() => {
    window.termcanvas.updater.install();
  }, []);

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

  const handleChangelogClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      e.preventDefault();
      const href = anchor.getAttribute("href");
      if (href && /^https?:\/\//.test(href)) {
        window.open(href);
      }
    },
    [],
  );

  const rawNotes =
    typeof info?.releaseNotes === "string" ? info.releaseNotes : "";
  const notes = extractLocalizedNotes(rawNotes, locale);
  const changelogHtml = notes
    ? (marked.parse(notes, { async: false }) as string)
    : "";

  return (
    <div
      ref={backdropRef}
      className="tc-enter-fade fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--scrim)]"
      onClick={handleBackdropClick}
    >
      <div
        className="tc-enter-fade-up w-[480px] max-h-[80vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)]"
        style={{ boxShadow: "var(--shadow-elev-2)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="tc-title">
              {status === "ready"
                ? t.update_modal_title_ready
                : t.update_modal_title}
            </h2>
            {info && <p className="tc-meta mt-0.5">v{info.version}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            style={{
              transitionDuration: "var(--duration-quick)",
              transitionTimingFunction: "var(--ease-out-soft)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {changelogHtml && (
          <div className="flex-1 min-h-0 overflow-auto px-5 py-4">
            <div
              className="tc-body-sm prose prose-sm dark:prose-invert max-w-none text-[var(--text-secondary)] [&_h1]:text-[15px] [&_h2]:text-[14px] [&_h3]:text-[13px] [&_h1]:text-[var(--text-primary)] [&_h2]:text-[var(--text-primary)] [&_h3]:text-[var(--text-primary)] [&_a]:text-[var(--accent)] [&_code]:text-[var(--accent)] [&_code]:bg-[var(--surface)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_ul]:pl-4 [&_li]:my-0.5"
              onClick={handleChangelogClick}
              dangerouslySetInnerHTML={{ __html: changelogHtml }}
            />
          </div>
        )}

        {status === "downloading" && (
          <div className="px-5 py-2">
            <div className="h-1.5 rounded-full bg-[var(--surface)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-deliberate"
                style={{ width: `${downloadPercent}%` }}
              />
            </div>
            <p className="tc-meta mt-1">
              {t.update_modal_downloading(downloadPercent)}
            </p>
          </div>
        )}

        {/* Error message */}
        {status === "error" && (
          <div className="px-5 py-3">
            <p className="tc-meta text-[var(--red)]">
              {errorMessage || t.update_modal_download_failed}
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="tc-ui px-3 py-1.5 hover:text-[var(--text-primary)] transition-colors"
            style={{
              transitionDuration: "var(--duration-quick)",
              transitionTimingFunction: "var(--ease-out-soft)",
            }}
          >
            {t.update_modal_later}
          </button>
          {status === "error" && (
            <button
              onClick={handleRetry}
              className="tc-ui px-4 py-1.5 text-[var(--accent-foreground)] bg-[var(--accent)] rounded-lg hover:brightness-110 transition-all"
            >
              {t.update_modal_retry}
            </button>
          )}
          {status === "ready" && (
            <button
              onClick={handleInstall}
              className="tc-ui px-4 py-1.5 text-[var(--accent-foreground)] bg-[var(--accent)] rounded-lg hover:brightness-110 transition-all"
            >
              {t.update_modal_restart}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
