import { useCallback, useEffect, useId, useRef } from "react";
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
  return notes.replace(/<!--\s*zh\s*-->[\s\S]*?<!--\s*\/zh\s*-->/g, "").trim();
}

export function UpdateModal({ onClose }: Props) {
  useBodyScrollLock(true);
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const { status, info, downloadPercent, errorMessage } = useUpdaterStore();
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);

  const handleInstall = useCallback(() => {
    window.termcanvas.updater.install();
  }, []);

  const handleRetry = useCallback(() => {
    useUpdaterStore.setState({ status: "checking", errorMessage: null });
    window.termcanvas.updater.check();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (status === "ready" || status === "error") {
      const id = window.setTimeout(() => primaryRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [status]);

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

  // A single primary slot drives the right-hand button across every
  // status, so the footer's width and rhythm don't pop when state moves
  // from downloading → ready.
  const primary: { label: string; disabled: boolean; onClick: () => void } | null =
    status === "ready"
      ? { label: t.update_modal_restart, disabled: false, onClick: handleInstall }
      : status === "error"
        ? { label: t.update_modal_retry, disabled: false, onClick: handleRetry }
        : status === "downloading"
          ? {
              label: t.update_modal_downloading(downloadPercent),
              disabled: true,
              onClick: () => {},
            }
          : status === "checking"
            ? { label: t.update_checking_short, disabled: true, onClick: () => {} }
            : null;

  const buttonBase =
    "tc-ui px-3 py-1.5 rounded-md transition-colors duration-150";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="tc-enter-fade fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--scrim)]"
      onClick={onClose}
    >
      <div
        className="tc-enter-fade-up w-[480px] max-h-[80vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)]"
        style={{ boxShadow: "var(--shadow-elev-2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <h2 id={titleId} className="tc-title">
              {status === "ready"
                ? t.update_modal_title_ready
                : t.update_modal_title}
            </h2>
            {info && <p className="tc-meta mt-0.5">v{info.version}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.cancel}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
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
          <div className="px-5 pt-2 pb-1">
            <div
              role="progressbar"
              aria-valuenow={Math.round(downloadPercent)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 rounded-full bg-[var(--surface)] overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-deliberate"
                style={{ width: `${downloadPercent}%` }}
              />
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="px-5 pt-2 pb-1">
            <p className="tc-meta text-[var(--red)]">
              {errorMessage || t.update_modal_download_failed}
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            className={`${buttonBase} border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]`}
          >
            {t.update_modal_later}
          </button>
          {primary && (
            <button
              ref={primaryRef}
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled}
              className={`${buttonBase} bg-[var(--green)] text-[var(--accent-foreground)] hover:brightness-110 disabled:bg-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:brightness-100`}
            >
              {primary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
