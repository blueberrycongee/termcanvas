import { useCallback, useEffect, useMemo, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useComposerStore } from "../stores/composerStore";
import { useNotificationStore } from "../stores/notificationStore";
import { getComposerAdapter } from "../terminal/cliConfig";
import { shouldSubmitComposerFromKeyEvent } from "./composerInputBehavior";
import {
  getComposerTargetState,
  getSupportedTerminals,
  resolveComposerTarget,
} from "./composerTarget";
import { useT } from "../i18n/useT";
import type {
  ComposerImageAttachment,
  ComposerSubmitIssueStage,
  ComposerSubmitRequest,
  ComposerSubmitResult,
} from "../types";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

function getComposerStageLabel(
  t: ReturnType<typeof useT>,
  stage: ComposerSubmitIssueStage,
) {
  switch (stage) {
    case "target":
      return t.composer_stage_target;
    case "validate":
      return t.composer_stage_validate;
    case "read-images":
      return t.composer_stage_read_images;
    case "prepare-images":
      return t.composer_stage_prepare_images;
    case "paste-image":
      return t.composer_stage_paste_image;
    case "paste-text":
      return t.composer_stage_paste_text;
    case "submit":
      return t.composer_stage_submit;
  }
}

function formatComposerFailure(
  t: ReturnType<typeof useT>,
  targetTitle: string,
  result: ComposerSubmitResult,
) {
  const stage = result.stage
    ? getComposerStageLabel(t, result.stage)
    : t.composer_stage_submit;
  const baseDetail = result.detail ?? result.error ?? "Unknown error";
  const detail = result.code
    ? `${baseDetail} [${result.code}]`
    : baseDetail;
  return t.composer_submit_failed_with_context(targetTitle, stage, detail);
}

const ARROW_SEQUENCES: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
};

/**
 * Map keyboard events to terminal escape sequences for keys that should be
 * forwarded to the PTY rather than handled by the Composer textarea.
 * Returns null if the key should stay in the textarea.
 */
function getPassthroughSequence(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  draft: string,
): string | null {
  // Shift+Tab → mode cycling (e.g. Claude Code permission modes)
  if (event.key === "Tab" && event.shiftKey) return "\x1b[Z";
  // Escape → cancel / go back
  if (event.key === "Escape") return "\x1b";
  // Ctrl+C → interrupt (only when no text is selected, so copy still works)
  if (event.key === "c" && event.ctrlKey && !event.metaKey) {
    const el = event.target as HTMLTextAreaElement;
    if (el.selectionStart === el.selectionEnd) {
      return "\x03";
    }
  }
  // Arrow keys → forward to terminal when Composer is empty
  // (no draft text means arrows have no cursor-movement purpose)
  const arrowSeq = ARROW_SEQUENCES[event.key];
  if (arrowSeq && draft.length === 0) {
    return arrowSeq;
  }
  return null;
}

export function ComposerBar() {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { notify } = useNotificationStore();
  const {
    draft,
    images,
    isSubmitting,
    error,
    setDraft,
    addImages,
    removeImage,
    clear,
    setSubmitting,
    setError,
  } = useComposerStore();
  const projects = useProjectStore((s) => s.projects);

  const supportedTerminals = useMemo(
    () =>
      getSupportedTerminals(
        projects,
        (terminalType) => getComposerAdapter(terminalType) !== null,
      ),
    [projects],
  );
  const targetTerminal = resolveComposerTarget(supportedTerminals);
  const targetState = getComposerTargetState(
    supportedTerminals,
    targetTerminal,
  );
  const targetAdapter = targetTerminal
    ? getComposerAdapter(targetTerminal.type)
    : null;
  const isTargetReady = targetState === "ready";

  // Auto-focus Composer when target terminal changes so the user can
  // start typing immediately without an extra click.
  const targetTerminalId = targetTerminal?.terminalId ?? null;
  useEffect(() => {
    if (targetTerminalId && isTargetReady) {
      textareaRef.current?.focus();
    }
  }, [targetTerminalId, isTargetReady]);

  const handleImagePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!targetTerminal || !targetAdapter) {
        const message = t.composer_missing_target;
        setError(message);
        notify("warn", message);
        return;
      }

      if (!targetAdapter.supportsImages) {
        const message = t.composer_images_unsupported(targetTerminal.title);
        setError(message);
        notify("warn", message);
        return;
      }

      const imageFiles = Array.from(event.clipboardData.items)
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

      if (imageFiles.length === 0) return;

      event.preventDefault();

      try {
        const pastedImages = await Promise.all(
          imageFiles.map(async (file, index) => ({
            id: `img-${Date.now()}-${index}`,
            name: file.name || `pasted-image-${index + 1}.png`,
            dataUrl: await fileToDataUrl(file),
          })),
        );
        addImages(pastedImages);
      } catch (pasteError) {
        const detail =
          pasteError instanceof Error ? pasteError.message : String(pasteError);
        const message = t.composer_image_read_failed(
          targetTerminal.title,
          `${detail} [image-read-failed]`,
        );
        setError(message);
        notify("error", message);
      }
    },
    [addImages, notify, setError, t, targetAdapter, targetTerminal],
  );

  const handleSubmit = useCallback(async () => {
    if (useComposerStore.getState().isSubmitting) return;

    if (!targetTerminal) {
      setError(t.composer_missing_target);
      notify("warn", t.composer_missing_target);
      return;
    }

    const adapter = getComposerAdapter(targetTerminal.type);
    if (!adapter) {
      setError(t.composer_missing_target);
      notify("warn", t.composer_missing_target);
      return;
    }

    if (!adapter.allowedStatuses.includes(targetTerminal.status)) {
      const message = t.composer_blocked_status(
        targetTerminal.title,
        targetTerminal.status,
      );
      setError(message);
      notify("warn", message);
      return;
    }

    if (images.length > 0 && !adapter.supportsImages) {
      const message = t.composer_images_unsupported(targetTerminal.title);
      setError(message);
      notify("warn", message);
      return;
    }

    if (draft.trim().length === 0 && images.length === 0) {
      setError(t.composer_empty_submit);
      notify("warn", t.composer_empty_submit);
      return;
    }

    const request: ComposerSubmitRequest = {
      terminalId: targetTerminal.terminalId,
      ptyId: targetTerminal.ptyId,
      terminalType: targetTerminal.type,
      worktreePath: targetTerminal.worktreePath,
      text: draft,
      images,
    };

    setSubmitting(true);
    setError(null);
    try {
      const result = await window.termcanvas.composer.submit(request);
      if (!result.ok) {
        const message = formatComposerFailure(t, targetTerminal.title, result);
        setError(message);
        notify("error", message);
        return;
      }

      clear();
      // The textarea was `disabled` during submission and lost DOM focus.
      // React may not have flushed the re-render (clearing `disabled`) yet,
      // so defer the focus to the next frame.
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : String(submitError);
      setError(message);
      notify("error", t.composer_submit_failed(message));
    } finally {
      setSubmitting(false);
    }
  }, [
    clear,
    draft,
    images,
    notify,
    setError,
    setSubmitting,
    targetTerminal,
    t,
  ]);

  let placeholder: string = t.composer_empty_state;
  if (targetState === "no-target") {
    placeholder = t.composer_no_target_placeholder;
  } else if (targetState === "ready") {
    placeholder = targetAdapter?.supportsImages
      ? t.composer_placeholder
      : t.composer_placeholder_text_only;
  }

  let targetLabel: string = t.composer_empty_state;
  if (targetState === "no-target") {
    targetLabel = t.composer_no_target_state;
  } else if (targetTerminal) {
    targetLabel = targetTerminal.label;
  }

  let note: string = t.composer_no_target_note;
  if (targetState === "empty") {
    note = t.composer_empty_state;
  } else if (targetState === "ready") {
    note = targetAdapter?.supportsImages
      ? t.composer_note
      : t.composer_note_text_only;
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-[90] pointer-events-none flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-4xl rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <span
            className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.composer_label}
          </span>
          <div className="flex-1" />
          <div
            className="max-w-[420px] truncate rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            title={targetLabel}
          >
            {targetLabel}
          </div>
        </div>

        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {images.map((image: ComposerImageAttachment) => (
              <div
                key={image.id}
                className="relative h-14 w-14 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]"
              >
                <img
                  src={image.dataUrl}
                  alt={image.name}
                  className="h-full w-full object-cover"
                />
                <button
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white transition-colors duration-150 hover:bg-black/80"
                  onClick={() => removeImage(image.id)}
                  disabled={isSubmitting}
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
            ))}
          </div>
        )}

        <div className="px-4 py-3">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={handleImagePaste}
            onKeyDown={(event) => {
              if (shouldSubmitComposerFromKeyEvent(event)) {
                event.preventDefault();
                void handleSubmit();
                return;
              }
              // Forward terminal control keys to the PTY so CLI shortcuts
              // (e.g. Claude Code mode cycling) work from the Composer.
              if (targetTerminal) {
                const seq = getPassthroughSequence(event, draft);
                if (seq !== null) {
                  event.preventDefault();
                  window.termcanvas.terminal.input(targetTerminal.ptyId, seq);
                }
              }
            }}
            rows={4}
            placeholder={placeholder}
            disabled={!isTargetReady || isSubmitting}
            className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[13px] text-[var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
          />

          <div className="mt-3 flex items-start gap-3">
            <div className="flex-1">
              <div className="text-[12px] text-[var(--text-secondary)]">{note}</div>
              {error && (
                <div className="mt-1 text-[12px] text-[var(--red)]">{error}</div>
              )}
            </div>
            <button
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-[#005cc5] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleSubmit()}
              disabled={!isTargetReady || isSubmitting}
            >
              {isSubmitting ? t.composer_submitting : t.composer_submit}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
