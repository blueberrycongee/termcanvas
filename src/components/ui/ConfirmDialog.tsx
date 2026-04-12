import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n/useT";

export type ConfirmTone = "neutral" | "danger";

interface Props {
  open: boolean;
  title: string;
  /**
   * Body content. May be a plain string, or arbitrary nodes (e.g. when the
   * caller wants to embed a type-to-confirm input or extra metadata).
   */
  body: ReactNode;
  confirmLabel: string;
  /**
   * Label shown on the confirm button while {@link busy} is true. Defaults to
   * `confirmLabel` if omitted.
   */
  busyLabel?: string;
  confirmTone?: ConfirmTone;
  /** When true, the confirm button shows busy state and dismissal is gated. */
  busy?: boolean;
  /** Independent of busy — for type-to-confirm gating. */
  disableConfirm?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * Optional override of the cancel label. Defaults to the i18n `cancel`
   * string.
   */
  cancelLabel?: string;
}

/**
 * Single confirmation primitive for destructive / consequential actions in
 * the right panel. Always renders via portal so it sits above the panel
 * stacking context.
 *
 * Behavior:
 * - Click on the backdrop dismisses (gated on `!busy`).
 * - Escape dismisses (gated on `!busy`).
 * - Enter on the confirm button triggers it via native button semantics.
 *
 * Styling derives from `confirmTone`. The danger tone matches the existing
 * delete-from-disk modal so the migration is a visual no-op for that flow.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busyLabel,
  confirmTone = "neutral",
  busy = false,
  disableConfirm = false,
  onCancel,
  onConfirm,
  cancelLabel,
}: Props) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, busy, onCancel]);

  useEffect(() => {
    if (open) {
      // Defer one tick so any caller-provided body input can grab focus
      // first if it autoFocuses; otherwise focus lands on the confirm button.
      const id = window.setTimeout(() => {
        if (
          document.activeElement === document.body ||
          document.activeElement === null
        ) {
          confirmRef.current?.focus();
        }
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  if (!open) return null;

  const confirmBaseClass =
    "text-[11px] px-2 py-1 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
  const confirmToneClass =
    confirmTone === "danger"
      ? "bg-red-600 text-white hover:bg-red-700"
      : "border border-[var(--accent)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-[420px] max-w-[90vw] rounded-md border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[12px] font-semibold text-[var(--text-primary)] mb-2">
          {title}
        </div>
        <div className="text-[11px] text-[var(--text-muted)] mb-3 leading-relaxed">
          {body}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="text-[11px] px-2 py-1 rounded border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] disabled:opacity-50"
          >
            {cancelLabel ?? t.cancel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={busy || disableConfirm}
            onClick={onConfirm}
            className={`${confirmBaseClass} ${confirmToneClass}`}
          >
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
