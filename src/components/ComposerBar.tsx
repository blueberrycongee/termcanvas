import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { updateTerminalCustomTitleInScene } from "../actions/terminalSceneActions";
import { findTerminalById, useProjectStore } from "../stores/projectStore";
import { useComposerStore } from "../stores/composerStore";
import { useHandoffDragStore } from "../stores/handoffDragStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useTerminalRuntimeStateStore } from "../stores/terminalRuntimeStateStore";
import { getComposerAdapter } from "../terminal/cliConfig";
import { filterSlashCommands } from "../terminal/slashCommands";
import { shouldSubmitComposerFromKeyEvent } from "./composerInputBehavior";
import {
  getComposerTargetState,
  getSupportedTerminals,
  resolveComposerTarget,
} from "./composerTarget";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { hasPrimaryModifier } from "../hooks/shortcutTarget";
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
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read image."));
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
  const detail = result.code ? `${baseDetail} [${result.code}]` : baseDetail;
  return t.composer_submit_failed_with_context(targetTitle, stage, detail);
}

const ARROW_SEQUENCES: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
};

function getPassthroughSequence(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  draft: string,
  hasImages: boolean,
): string | null {
  if (event.key === "Tab" && event.shiftKey) return "\x1b[Z";
  if (event.key === "Escape") return "\x1b";
  if (event.key === "c" && event.ctrlKey && !event.metaKey) {
    const el = event.target as HTMLTextAreaElement;
    if (el.selectionStart === el.selectionEnd) {
      return "\x03";
    }
  }
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    draft.trim().length === 0 &&
    !hasImages
  ) {
    return "\r";
  }
  if (event.key === "Backspace" && draft.length === 0 && !hasImages) {
    return "\x7f";
  }
  const arrowSeq = ARROW_SEQUENCES[event.key];
  if (arrowSeq && (hasPrimaryModifier(event) || draft.trim().length === 0)) {
    return arrowSeq;
  }
  return null;
}

export function ComposerBar() {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { notify } = useNotificationStore();
  const {
    draft,
    images,
    isSubmitting,
    error,
    mode,
    renameTerminalId,
    setDraft,
    addImages,
    removeImage,
    clear,
    setSubmitting,
    setError,
    exitRenameTerminalTitleMode,
  } = useComposerStore();
  const projects = useProjectStore((s) => s.projects);
  const terminalRuntimeStates = useTerminalRuntimeStateStore(
    (s) => s.terminals,
  );
  const composerLeft = 0;
  const composerRight = useCanvasStore((s) =>
    s.rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : s.rightPanelWidth,
  );
  const isRenameMode = mode === "renameTerminalTitle";

  const supportedTerminals = useMemo(
    () =>
      getSupportedTerminals(
        projects,
        (terminalType) => getComposerAdapter(terminalType) !== null,
        terminalRuntimeStates,
      ),
    [projects, terminalRuntimeStates],
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
  const renameTarget = useMemo(
    () =>
      renameTerminalId ? findTerminalById(projects, renameTerminalId) : null,
    [projects, renameTerminalId],
  );

  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const slashNavigatedRef = useRef(false);
  // Track explicit dismissals (Escape / click-outside) so the useEffect
  // doesn't re-open the menu when an unrelated dep like targetTerminal changes.
  const slashDismissedRef = useRef(false);
  const prevSlashDraftRef = useRef(draft);

  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const handoffActive = useHandoffDragStore((s) => s.active);
  const handoffHoveredComposer = useHandoffDragStore((s) => s.hoveredComposer);
  const isHandoffTarget = handoffActive && handoffHoveredComposer;

  // Submit-feedback state. `submitTick` keys the input-flash element so
  // the keyframe replays on every successful send (a stable React node
  // would only animate once). `sentLabel` carries the transient
  // acknowledgement text ("Sent" for compose, "Saved" for rename) and
  // doubles as the "show sent state" flag.
  const [submitTick, setSubmitTick] = useState(0);
  const [sentLabel, setSentLabel] = useState<string | null>(null);
  const sentResetRef = useRef<number | null>(null);
  const triggerSent = useCallback((label: string) => {
    setSubmitTick((n) => n + 1);
    setSentLabel(label);
    if (sentResetRef.current !== null) {
      window.clearTimeout(sentResetRef.current);
    }
    sentResetRef.current = window.setTimeout(() => {
      setSentLabel(null);
      sentResetRef.current = null;
    }, 700);
  }, []);
  useEffect(() => {
    return () => {
      if (sentResetRef.current !== null) {
        window.clearTimeout(sentResetRef.current);
      }
    };
  }, []);

  const slashCommands = useMemo(() => {
    if (!slashMenuOpen || !targetTerminal) return [];
    const query = draft.startsWith("/") ? draft.slice(1) : "";
    return filterSlashCommands(targetTerminal.type, query);
  }, [slashMenuOpen, targetTerminal, draft]);

  useEffect(() => {
    if (isRenameMode) {
      setSlashMenuOpen(false);
      return;
    }

    if (prevSlashDraftRef.current !== draft) {
      prevSlashDraftRef.current = draft;
      slashDismissedRef.current = false;
    }

    if (draft.startsWith("/") && targetTerminal) {
      if (slashDismissedRef.current) return;

      const commands = filterSlashCommands(targetTerminal.type, draft.slice(1));
      if (commands.length > 0) {
        setSlashMenuOpen((wasOpen) => {
          if (!wasOpen) {
            setSlashSelectedIndex(0);
            slashNavigatedRef.current = false;
          } else {
            setSlashSelectedIndex((prev) =>
              Math.min(prev, commands.length - 1),
            );
          }
          return true;
        });
        return;
      }
    }
    setSlashMenuOpen(false);
  }, [draft, isRenameMode, targetTerminal]);

  const handleSlashClose = useCallback(() => {
    slashDismissedRef.current = true;
    setSlashMenuOpen(false);
  }, []);

  const handleSlashSelect = useCallback(
    (command: string) => {
      setDraft(command);
      setSlashMenuOpen(false);
      textareaRef.current?.focus();
    },
    [setDraft],
  );

  // Auto-focus Composer when target terminal changes so the user can
  // start typing immediately without an extra click.
  const targetTerminalId = targetTerminal?.terminalId ?? null;
  useEffect(() => {
    if (targetTerminalId && isTargetReady) {
      textareaRef.current?.focus();
    }
  }, [targetTerminalId, isTargetReady]);

  useEffect(() => {
    const handleFocusComposer = () =>
      requestAnimationFrame(() => textareaRef.current?.focus());
    window.addEventListener("termcanvas:focus-composer", handleFocusComposer);
    return () =>
      window.removeEventListener(
        "termcanvas:focus-composer",
        handleFocusComposer,
      );
  }, []);

  // Publish the composer's measured height so the floating BottomToolbar
  // can sit just above it. Without this it ends up obscured the moment
  // the user adds a second line, image, or rename row.
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const root = document.documentElement;
    const publish = (height: number) => {
      root.style.setProperty("--composer-height", `${Math.round(height)}px`);
    };
    publish(node.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) publish(entry.contentRect.height);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--composer-height");
    };
  }, []);

  const handleImagePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (isRenameMode) return;

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
    [
      addImages,
      isRenameMode,
      notify,
      setError,
      t,
      targetAdapter,
      targetTerminal,
    ],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      if (isRenameMode) return;

      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;

      const imageFiles: File[] = [];
      const nonImagePaths: string[] = [];

      for (const file of files) {
        if (file.type.startsWith("image/")) {
          imageFiles.push(file);
        } else {
          const filePath = (file as File & { path?: string }).path;
          if (filePath) {
            nonImagePaths.push(filePath);
          }
        }
      }

      if (imageFiles.length > 0) {
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
        try {
          const droppedImages = await Promise.all(
            imageFiles.map(async (file, index) => ({
              id: `img-${Date.now()}-${index}`,
              name: file.name || `dropped-image-${index + 1}.png`,
              dataUrl: await fileToDataUrl(file),
            })),
          );
          addImages(droppedImages);
        } catch (dropError) {
          const detail =
            dropError instanceof Error ? dropError.message : String(dropError);
          const message = t.composer_image_read_failed(
            targetTerminal.title,
            `${detail} [image-read-failed]`,
          );
          setError(message);
          notify("error", message);
          return;
        }
      }

      if (nonImagePaths.length > 0) {
        const pathText = nonImagePaths
          .map((p) =>
            /[\s"'\\$`!#&|;()<>]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p,
          )
          .join(" ");
        const textarea = textareaRef.current;
        if (textarea) {
          const { selectionStart, selectionEnd } = textarea;
          const currentDraft = useComposerStore.getState().draft;
          const before = currentDraft.slice(0, selectionStart);
          const after = currentDraft.slice(selectionEnd);
          const needsLeadingSpace =
            before.length > 0 &&
            !before.endsWith(" ") &&
            !before.endsWith("\n");
          const insertion = (needsLeadingSpace ? " " : "") + pathText;
          setDraft(before + insertion + after);
        } else {
          const currentDraft = useComposerStore.getState().draft;
          const needsSpace =
            currentDraft.length > 0 &&
            !currentDraft.endsWith(" ") &&
            !currentDraft.endsWith("\n");
          setDraft(currentDraft + (needsSpace ? " " : "") + pathText);
        }
      }
    },
    [
      addImages,
      isRenameMode,
      notify,
      setDraft,
      setError,
      t,
      targetAdapter,
      targetTerminal,
    ],
  );

  const handleSubmit = useCallback(async () => {
    if (useComposerStore.getState().isSubmitting) return;

    if (isRenameMode) {
      if (!renameTarget) {
        setError(t.composer_rename_title_missing_target);
        notify("warn", t.composer_rename_title_missing_target);
        return;
      }

      updateTerminalCustomTitleInScene(
        renameTarget.projectId,
        renameTarget.worktreeId,
        renameTarget.terminal.id,
        draft,
      );
      setError(null);
      exitRenameTerminalTitleMode();
      triggerSent(t.composer_saved);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

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
      triggerSent(t.composer_sent);
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : String(submitError);
      setError(message);
      notify("error", t.composer_submit_failed(message));
    } finally {
      setSubmitting(false);
      // Restore focus unconditionally (success, failure, and error paths).
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [
    clear,
    draft,
    images,
    notify,
    exitRenameTerminalTitleMode,
    isRenameMode,
    renameTarget,
    setError,
    setSubmitting,
    targetTerminal,
    t,
    triggerSent,
    updateTerminalCustomTitleInScene,
  ]);

  let placeholder: string = t.composer_empty_state;
  if (isRenameMode) {
    placeholder = t.composer_rename_title_placeholder;
  } else if (targetState === "no-target") {
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
  if (isRenameMode) {
    note = t.composer_rename_title_note;
  } else if (targetState === "empty") {
    note = t.composer_empty_state;
  } else if (targetState === "ready") {
    note = targetAdapter?.supportsImages
      ? t.composer_note
      : t.composer_note_text_only;
  }
  const isComposerDisabled = isRenameMode
    ? renameTarget === null || isSubmitting
    : !isTargetReady || isSubmitting;
  const hasSubmittableContent = draft.trim().length > 0 || images.length > 0;
  type SendState = "idle" | "ready" | "submitting" | "sent";
  const sendState: SendState = isSubmitting
    ? "submitting"
    : sentLabel !== null && !hasSubmittableContent
      ? "sent"
      : hasSubmittableContent
        ? "ready"
        : "idle";
  const sendButtonLabel =
    sendState === "submitting"
      ? t.composer_submitting
      : sendState === "sent"
        ? (sentLabel ?? t.composer_sent)
        : isRenameMode
          ? t.composer_rename_title_submit
          : t.composer_submit;
  const sendButtonStyle: CSSProperties = (() => {
    const base: CSSProperties = {
      top: "50%",
      transform: "translateY(-50%)",
    };
    switch (sendState) {
      case "ready":
        return {
          ...base,
          opacity: 1,
          boxShadow:
            "0 2px 12px color-mix(in srgb, var(--accent) 24%, transparent)",
        };
      case "submitting":
        return { ...base, opacity: 0.9, boxShadow: "none" };
      case "sent":
        return {
          ...base,
          opacity: 1,
          boxShadow:
            "0 0 0 2px color-mix(in srgb, var(--accent) 38%, transparent)",
        };
      case "idle":
      default:
        return { ...base, opacity: 0.55, boxShadow: "none" };
    }
  })();

  return (
    <div
      ref={wrapperRef}
      className="fixed bottom-4 z-[90] pointer-events-none flex justify-center px-4"
      style={{ left: composerLeft, right: composerRight }}
    >
      <div
        data-handoff-composer="true"
        data-handoff-target={isHandoffTarget ? "true" : undefined}
        className={`pointer-events-auto w-full max-w-4xl rounded-xl border bg-[var(--surface)] shadow-[0_18px_48px_-12px_color-mix(in_srgb,var(--shadow-color)_36%,transparent)] transition-colors duration-quick ${
          isDragOver
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : isHandoffTarget
              ? "border-[var(--cyan)] bg-[color-mix(in_srgb,var(--cyan)_8%,transparent)]"
              : "border-[var(--border)]"
        }`}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounterRef.current += 1;
          if (dragCounterRef.current === 1) setIsDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounterRef.current -= 1;
          if (dragCounterRef.current === 0) setIsDragOver(false);
        }}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[var(--border)]">
          <span
            className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.composer_label}
          </span>
          <div className="flex-1" />
          <div
            className="max-w-[420px] truncate rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            title={targetLabel}
          >
            {targetLabel}
          </div>
        </div>

        {isDragOver && (
          <div className="flex items-center justify-center py-3 text-[12px] font-medium text-[var(--accent)]">
            {t.composer_drop_hint}
          </div>
        )}

        {images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {images.map((image: ComposerImageAttachment) => (
              <div
                key={image.id}
                className="relative h-10 w-10 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)]"
              >
                <img
                  src={image.dataUrl}
                  alt={image.name}
                  className="h-full w-full object-cover"
                />
                <button
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white transition-colors duration-quick hover:bg-black/80"
                  onClick={() => removeImage(image.id)}
                  disabled={isSubmitting}
                >
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="px-3 py-2">
          <div className="relative">
            {slashMenuOpen && slashCommands.length > 0 && (
              <SlashCommandMenu
                commands={slashCommands}
                selectedIndex={slashSelectedIndex}
                onSelect={handleSlashSelect}
                onClose={handleSlashClose}
              />
            )}
            {submitTick > 0 && (
              <span
                key={submitTick}
                aria-hidden
                className="tc-composer-input-flash pointer-events-none absolute inset-0 rounded-lg"
              />
            )}
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={handleImagePaste}
              onKeyDown={(event) => {
                if (isRenameMode) {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    exitRenameTerminalTitleMode();
                    return;
                  }

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSubmit();
                  }
                  return;
                }

                if (slashMenuOpen && slashCommands.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    slashNavigatedRef.current = true;
                    setSlashSelectedIndex((i) =>
                      i < slashCommands.length - 1 ? i + 1 : 0,
                    );
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    slashNavigatedRef.current = true;
                    setSlashSelectedIndex((i) =>
                      i > 0 ? i - 1 : slashCommands.length - 1,
                    );
                    return;
                  }
                  // Tab always selects; Enter only selects after explicit
                  // arrow-key navigation — otherwise it falls through to
                  // normal submit so the user can send partial input like
                  // "/he" without accidentally picking "/help".
                  if (
                    event.key === "Tab" ||
                    (event.key === "Enter" && slashNavigatedRef.current)
                  ) {
                    event.preventDefault();
                    handleSlashSelect(
                      slashCommands[slashSelectedIndex].command,
                    );
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    handleSlashClose();
                    return;
                  }
                }

                if (targetTerminal) {
                  const seq = getPassthroughSequence(
                    event,
                    draft,
                    images.length > 0,
                  );
                  if (seq !== null) {
                    event.preventDefault();
                    window.termcanvas.terminal.input(targetTerminal.ptyId, seq);
                    return;
                  }
                }
                if (shouldSubmitComposerFromKeyEvent(event)) {
                  event.preventDefault();
                  void handleSubmit();
                  return;
                }
              }}
              rows={2}
              placeholder={placeholder}
              disabled={isComposerDisabled}
              className="relative w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] pl-3 pr-20 py-2 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
              style={{
                transition:
                  "border-color var(--duration-quick) var(--ease-out-soft)",
              }}
            />
            <button
              className={`tc-composer-send-button absolute right-2 inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-foreground)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${
                sendState === "sent" ? "tc-composer-send-pulse" : ""
              }`}
              style={sendButtonStyle}
              onClick={() => void handleSubmit()}
              disabled={isComposerDisabled}
            >
              {sendState === "submitting" && (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                  className="animate-spin"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeOpacity="0.3"
                  />
                  <path
                    d="M14 8a6 6 0 0 1-6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              {sendState === "sent" && (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M3 8.5L6.5 12L13 4.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              <span>{sendButtonLabel}</span>
            </button>
          </div>
          {error && (
            <div className="mt-1 text-[11px] text-[var(--red)] px-1">
              {error}
            </div>
          )}
          {!error && (
            <div className="mt-1 px-1 text-[11px] text-[var(--text-muted)]">
              {note}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
