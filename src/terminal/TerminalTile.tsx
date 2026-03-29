import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { TerminalData } from "../types";
import { useProjectStore, findTerminalById, getChildTerminals } from "../stores/projectStore";
import { useSelectionStore } from "../stores/selectionStore";
import { ContextMenu } from "../components/ContextMenu";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useT } from "../i18n/useT";
import { getComposerAdapter } from "./cliConfig";
import { panToTerminal } from "../utils/panToTerminal";
import {
  attachTerminalContainer,
  blurTerminalRuntime,
  destroyTerminalRuntime,
  detachTerminalContainer,
  fitTerminalRuntime,
  focusTerminalRuntime,
  getTerminalPtyId,
  touchTerminalRuntime,
  useTerminalRuntimeStore,
} from "./terminalRuntimeStore";
import type { TerminalMountMode } from "./terminalRuntimePolicy";
import { shellEscapePath } from "../utils/shellEscape";
import { getTelemetryBadgeLabel, getTelemetryFacts } from "./telemetryPresentation";
import {
  cancelScheduledTerminalFocus,
  scheduleTerminalFocus,
} from "./focusScheduler";

interface Props {
  lodMode: TerminalMountMode;
  projectId: string;
  worktreeId: string;
  worktreePath: string;
  terminal: TerminalData;
  gridX: number;
  gridY: number;
  width: number;
  height: number;
  onDragStart?: (terminalId: string, e: React.MouseEvent) => void;
  isDragging?: boolean;
  dragOffsetX?: number;
  dragOffsetY?: number;
  onDoubleClick?: () => void;
  onSpanChange?: (span: { cols: number; rows: number }) => void;
}

const TYPE_CONFIG: Record<string, { color: string; label: string }> = {
  shell: { color: "#888", label: "Shell" },
  claude: { color: "#f5a623", label: "Claude" },
  codex: { color: "#7928ca", label: "Codex" },
  kimi: { color: "#0070f3", label: "Kimi" },
  gemini: { color: "#4285f4", label: "Gemini" },
  opencode: { color: "#50e3c2", label: "OpenCode" },
  lazygit: { color: "#e84d31", label: "Lazygit" },
  tmux: { color: "#1bb91f", label: "Tmux" },
};

function HierarchyBadges({ terminal }: { terminal: TerminalData }) {
  const projects = useProjectStore((s) => s.projects);

  const parentInfo = terminal.parentTerminalId
    ? findTerminalById(projects, terminal.parentTerminalId)
    : null;
  const children = getChildTerminals(projects, terminal.id);

  if (!parentInfo && children.length === 0) return null;

  return (
    <>
      {parentInfo && (
        <button
          className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors duration-150 shrink-0"
          title={`Parent: ${parentInfo.terminal.title} (${parentInfo.terminal.type})`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            panToTerminal(parentInfo.terminal.id);
          }}
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
            <path d="M6 9V3M3 5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {parentInfo.terminal.type}
        </button>
      )}
      {children.length > 0 && (
        <button
          className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--border)] transition-colors duration-150 shrink-0"
          title={`${children.length} agent${children.length > 1 ? "s" : ""}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            panToTerminal(children[0].terminal.id);
          }}
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v4M3 4v4M9 4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {children.length}
        </button>
      )}
    </>
  );
}

function PreviewPane({
  lodMode,
  previewText,
}: {
  lodMode: TerminalMountMode;
  previewText: string;
}) {
  const label = lodMode === "preview" ? "Preview" : "Dormant";
  const body =
    previewText.trim().length > 0
      ? previewText
      : lodMode === "preview"
        ? "No buffered output yet."
        : "Renderer detached while the PTY stays alive.";

  return (
    <div
      className="flex-1 min-h-0 overflow-hidden px-1 pb-1"
      style={{ pointerEvents: "none" }}
    >
      <div className="flex h-full min-h-0 flex-col rounded-sm border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_78%,transparent)] px-3 py-2">
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-[var(--text-faint)]">
          <span
            className="rounded-full border border-[var(--border)] px-1.5 py-0.5 uppercase tracking-[0.18em]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {label}
          </span>
          <span style={{ fontFamily: '"Geist Mono", monospace' }}>
            xterm detached
          </span>
        </div>
        <pre
          className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap break-words text-[11px] leading-5 text-[var(--text-secondary)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {body}
        </pre>
      </div>
    </div>
  );
}

function TelemetrySummary({ terminalId }: { terminalId: string }) {
  const telemetry = useTerminalRuntimeStore((s) => s.terminals[terminalId]?.telemetry ?? null);
  const badge = getTelemetryBadgeLabel(telemetry);
  const facts = getTelemetryFacts(telemetry);

  if (!telemetry || !badge) {
    return null;
  }

  return (
    <div className="flex min-w-0 max-w-[18rem] shrink items-center gap-2">
      <span
        className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em] text-[var(--text-secondary)]"
        style={{ fontFamily: '"Geist Mono", monospace' }}
        title={facts.join(" • ")}
      >
        {badge}
      </span>
      <span
        className="min-w-0 truncate text-[10px] text-[var(--text-faint)]"
        style={{ fontFamily: '"Geist Mono", monospace' }}
        title={facts.join(" • ")}
      >
        {facts.join(" • ")}
      </span>
    </div>
  );
}

export function TerminalTile({
  lodMode,
  projectId,
  worktreeId,
  worktreePath,
  terminal,
  gridX,
  gridY,
  width,
  height,
  onDragStart,
  isDragging = false,
  dragOffsetX = 0,
  dragOffsetY = 0,
  onDoubleClick,
  onSpanChange,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [showCopiedToast, setShowCopiedToast] = useState(false);
  const [isEditingCustomTitle, setIsEditingCustomTitle] = useState(false);
  const [customTitleDraft, setCustomTitleDraft] = useState(
    terminal.customTitle ?? "",
  );
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingFocusFrameRef = useRef<number | null>(null);
  const customTitleInputRef = useRef<HTMLInputElement>(null);
  const copiedNonce = useTerminalRuntimeStore(
    (s) => s.terminals[terminal.id]?.copiedNonce ?? 0,
  );
  const previewText = useTerminalRuntimeStore(
    (s) => s.terminals[terminal.id]?.previewText ?? "",
  );
  const [dragOver, setDragOver] = useState(false);

  const {
    removeTerminal,
    toggleTerminalMinimize,
    toggleTerminalStarred,
    updateTerminalCustomTitle,
    setFocusedTerminal,
  } = useProjectStore();

  const t = useT();
  const config = TYPE_CONFIG[terminal.type] ?? {
    color: "#888",
    label: terminal.type,
  };

  useEffect(() => {
    if (!isEditingCustomTitle) {
      setCustomTitleDraft(terminal.customTitle ?? "");
    }
  }, [isEditingCustomTitle, terminal.customTitle]);

  const startCustomTitleEdit = useCallback(() => {
    setCustomTitleDraft(terminal.customTitle ?? "");
    setIsEditingCustomTitle(true);
  }, [terminal.customTitle]);

  const stopCustomTitleEdit = useCallback(() => {
    setIsEditingCustomTitle(false);
  }, []);

  const saveCustomTitleEdit = useCallback(() => {
    updateTerminalCustomTitle(
      projectId,
      worktreeId,
      terminal.id,
      customTitleDraft,
    );
    setIsEditingCustomTitle(false);
  }, [
    customTitleDraft,
    projectId,
    terminal.id,
    updateTerminalCustomTitle,
    worktreeId,
  ]);

  useEffect(() => {
    if (!isEditingCustomTitle) return;

    requestAnimationFrame(() => {
      customTitleInputRef.current?.focus();
      customTitleInputRef.current?.select();
    });
  }, [isEditingCustomTitle]);

  const isSelected = useSelectionStore((s) =>
    s.selectedItems.some(
      (item) => item.type === "terminal" && item.terminalId === terminal.id,
    ),
  );
  const selectTerminal = useSelectionStore((s) => s.selectTerminal);

  useEffect(() => {
    if (copiedNonce === 0) {
      return;
    }

    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
    }
    setShowCopiedToast(true);
    copiedTimerRef.current = setTimeout(() => {
      setShowCopiedToast(false);
      copiedTimerRef.current = null;
    }, 1_500);
  }, [copiedNonce]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (lodMode !== "live" || !containerRef.current) {
      return;
    }

    attachTerminalContainer(terminal.id, containerRef.current);
    return () => {
      detachTerminalContainer(terminal.id);
    };
  }, [lodMode, terminal.id]);

  useEffect(() => {
    if (terminal.minimized || lodMode !== "live") return;

    const frame = requestAnimationFrame(() => {
      fitTerminalRuntime(terminal.id);
    });

    return () => cancelAnimationFrame(frame);
  }, [height, lodMode, terminal.id, terminal.minimized, width]);

  const composerEnabled = usePreferencesStore((s) => s.composerEnabled);
  const focusLiveTerminal = useCallback(() => {
    const tile = tileRef.current;
    if (!tile || tile.getClientRects().length === 0) {
      return false;
    }

    if (!focusTerminalRuntime(terminal.id)) {
      return false;
    }

    return tile.contains(document.activeElement);
  }, [terminal.id]);

  const scheduleXtermFocus = useCallback(() => {
    scheduleTerminalFocus(focusLiveTerminal, pendingFocusFrameRef);
  }, [focusLiveTerminal]);

  useEffect(() => {
    const adapter = getComposerAdapter(terminal.type);
    const shouldFocusXterm =
      lodMode === "live" &&
      terminal.focused &&
      (!adapter || !composerEnabled);

    if (terminal.focused && lodMode === "live") {
      touchTerminalRuntime(terminal.id);
    }

    if (shouldFocusXterm) {
      scheduleXtermFocus();
    } else {
      cancelScheduledTerminalFocus(pendingFocusFrameRef);
      blurTerminalRuntime(terminal.id);
    }
  }, [
    composerEnabled,
    lodMode,
    scheduleXtermFocus,
    terminal.focused,
    terminal.id,
    terminal.type,
  ]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === terminal.id) {
        scheduleXtermFocus();
      }
    };
    window.addEventListener("termcanvas:focus-xterm", handler);
    return () => window.removeEventListener("termcanvas:focus-xterm", handler);
  }, [scheduleXtermFocus, terminal.id]);

  useEffect(
    () => () => {
      cancelScheduledTerminalFocus(pendingFocusFrameRef);
    },
    [],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === terminal.id) {
        startCustomTitleEdit();
      }
    };
    window.addEventListener("termcanvas:focus-custom-title", handler);
    return () =>
      window.removeEventListener("termcanvas:focus-custom-title", handler);
  }, [startCustomTitleEdit, terminal.id]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || lodMode !== "live") return;

    const corrected = new WeakSet<Event>();

    const fix = (e: MouseEvent) => {
      if (corrected.has(e)) return;
      const { scale } = useCanvasStore.getState().viewport;
      if (scale === 1) return;

      const rect = container.getBoundingClientRect();
      const adjusted = new MouseEvent(e.type, {
        altKey: e.altKey,
        bubbles: e.bubbles,
        button: e.button,
        buttons: e.buttons,
        cancelable: e.cancelable,
        clientX: rect.left + (e.clientX - rect.left) / scale,
        clientY: rect.top + (e.clientY - rect.top) / scale,
        ctrlKey: e.ctrlKey,
        detail: e.detail,
        metaKey: e.metaKey,
        screenX: e.screenX,
        screenY: e.screenY,
        shiftKey: e.shiftKey,
      });

      corrected.add(adjusted);
      e.stopPropagation();
      e.preventDefault();
      e.target?.dispatchEvent(adjusted);
    };

    // When zoomed, capture pointer on mousedown so that mousemove/mouseup
    // events route through this container even when the cursor leaves it.
    // Without this, xterm's document-level selection listener receives
    // uncorrected coordinates while the mouse is outside, causing the
    // selection to jump when the mouse re-enters.
    const capturePointer = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { scale } = useCanvasStore.getState().viewport;
      if (scale === 1) return;
      const target = e.target instanceof Element ? e.target : container;
      target.setPointerCapture(e.pointerId);
    };

    const types = ["mousedown", "mousemove", "mouseup", "dblclick"];
    for (const type of types) {
      container.addEventListener(type, fix as EventListener, true);
    }
    container.addEventListener("pointerdown", capturePointer);

    return () => {
      for (const type of types) {
        container.removeEventListener(type, fix as EventListener, true);
      }
      container.removeEventListener("pointerdown", capturePointer);
    };
  }, [lodMode]);

  // Intercept drag events on the xterm container in the capture phase so they
  // are not swallowed by xterm's own handlers.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || lodMode !== "live") return;

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    };

    const onDragLeave = (e: DragEvent) => {
      e.stopPropagation();
      setDragOver(false);
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const filePath = e.dataTransfer?.getData("text/plain");
      if (!filePath) return;

      const ptyId = getTerminalPtyId(terminal.id);
      if (ptyId === null) return;

      const escaped = shellEscapePath(filePath);
      window.termcanvas.terminal.input(ptyId, " " + escaped);
    };

    container.addEventListener("dragover", onDragOver, true);
    container.addEventListener("dragleave", onDragLeave, true);
    container.addEventListener("drop", onDrop, true);

    return () => {
      container.removeEventListener("dragover", onDragOver, true);
      container.removeEventListener("dragleave", onDragLeave, true);
      container.removeEventListener("drop", onDrop, true);
    };
  }, [lodMode, terminal.id]);

  const handleClose = useCallback(() => {
    destroyTerminalRuntime(terminal.id);
    removeTerminal(projectId, worktreeId, terminal.id);
  }, [projectId, removeTerminal, terminal.id, worktreeId]);

  const handleTileDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, []);

  const handleTileDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleTileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const filePath = e.dataTransfer.getData("text/plain");
      if (!filePath) return;

      const ptyId = getTerminalPtyId(terminal.id);
      if (ptyId === null) return;

      const escaped = shellEscapePath(filePath);
      window.termcanvas.terminal.input(ptyId, " " + escaped);
    },
    [terminal.id],
  );

  return (
    <div
      ref={tileRef}
      onDragOver={handleTileDragOver}
      onDragLeave={handleTileDragLeave}
      onDrop={handleTileDrop}
      className="absolute terminal-tile rounded-md bg-[var(--bg)] overflow-hidden flex flex-col"
      style={{
        left: gridX + (isDragging ? dragOffsetX : 0),
        top: gridY + (isDragging ? dragOffsetY : 0),
        width,
        height: terminal.minimized ? "auto" : height,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.9 : 1,
        transition: isDragging ? "none" : "left 0.2s ease, top 0.2s ease",
        boxShadow: isDragging
          ? "0 8px 32px rgba(0,0,0,0.3)"
          : dragOver
            ? "0 0 0 2px var(--accent), 0 0 12px color-mix(in srgb, var(--accent) 25%, transparent)"
            : terminal.focused
              ? "0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent), 0 0 8px color-mix(in srgb, var(--accent) 15%, transparent)"
              : undefined,
        transform: isDragging ? "scale(1.02)" : undefined,
        outline: "none",
      }}
      onClick={(e) => {
        e.stopPropagation();
        setFocusedTerminal(terminal.id);
        selectTerminal(projectId, worktreeId, terminal.id);
      }}
      onMouseEnter={() => {
        window.dispatchEvent(
          new CustomEvent("termcanvas:terminal-hover", { detail: terminal.id }),
        );
      }}
      onMouseLeave={() => {
        window.dispatchEvent(
          new CustomEvent("termcanvas:terminal-hover", { detail: null }),
        );
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 select-none shrink-0 cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => onDragStart?.(terminal.id, e)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {terminal.origin !== "agent" && (
          <div className="w-[3px] h-3 rounded-full bg-amber-500/60 shrink-0" />
        )}
        <span
          className="text-[11px] font-medium"
          style={{ color: config.color, fontFamily: '"Geist Mono", monospace' }}
        >
          {config.label}
        </span>
        <HierarchyBadges terminal={terminal} />
        <span
          className="min-w-0 max-w-[9rem] shrink truncate text-[11px] text-[var(--text-muted)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {terminal.title}
        </span>
        <TelemetrySummary terminalId={terminal.id} />
        <div
          className={`h-6 min-w-[8rem] flex-1 rounded-md border px-1.5 text-[11px] ${
            terminal.customTitle
              ? "border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]"
              : "border-dashed border-[var(--border)] bg-[var(--bg)] text-[var(--text-faint)]"
          }`}
          style={{ fontFamily: '"Geist Mono", monospace' }}
          title={terminal.customTitle || t.terminal_custom_title_placeholder}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            startCustomTitleEdit();
          }}
        >
          <div className="flex h-full items-center gap-1.5 min-w-0">
            <button
              className={`shrink-0 rounded p-0.5 transition-colors duration-150 ${
                terminal.starred
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-[var(--text-faint)] hover:text-amber-400"
              }`}
              title={terminal.starred ? t.terminal_unstar : t.terminal_star}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleTerminalStarred(projectId, worktreeId, terminal.id);
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path
                  d="M5 1.2l1.05 2.13 2.35.34-1.7 1.66.4 2.35L5 6.58 2.9 7.68l.4-2.35L1.6 3.67l2.35-.34L5 1.2z"
                  fill={terminal.starred ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {isEditingCustomTitle ? (
              <input
                ref={customTitleInputRef}
                className="min-w-0 flex-1 bg-transparent outline-none leading-[22px] text-[var(--text-primary)]"
                value={customTitleDraft}
                placeholder={t.terminal_custom_title_placeholder}
                onChange={(e) => setCustomTitleDraft(e.target.value)}
                onBlur={saveCustomTitleEdit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveCustomTitleEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    stopCustomTitleEdit();
                  }
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate leading-[22px]">
                {terminal.customTitle || t.terminal_custom_title_placeholder}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleTerminalMinimize(projectId, worktreeId, terminal.id);
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              {terminal.minimized ? (
                <rect
                  x="2"
                  y="2"
                  width="6"
                  height="6"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  rx="0.5"
                />
              ) : (
                <path
                  d="M2 5H8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
          <button
            className="text-[var(--text-faint)] hover:text-[var(--red)] transition-colors duration-150 p-1 rounded-md hover:bg-[var(--border)]"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
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
      </div>

      {lodMode === "live" ? (
        <div
          ref={containerRef}
          className={terminal.minimized ? "" : "flex-1 min-h-0"}
          style={{
            height: terminal.minimized ? 0 : undefined,
            padding: 0,
            overflow: "hidden",
          }}
          onClick={() => {
            const adapter = getComposerAdapter(terminal.type);
            if (!adapter || adapter.inputMode === "type" || !composerEnabled) {
              scheduleXtermFocus();
            }
          }}
        />
      ) : (
        <div
          className={terminal.minimized ? "" : "flex-1 min-h-0"}
          style={{
            height: terminal.minimized ? 0 : undefined,
            overflow: "hidden",
          }}
        >
          {!terminal.minimized && (
            <PreviewPane lodMode={lodMode} previewText={previewText} />
          )}
        </div>
      )}

      {showCopiedToast && (
        <div className="absolute left-1/2 bottom-3 -translate-x-1/2 px-3 py-1 rounded-md bg-[var(--surface)] text-[var(--text-primary)] text-xs font-medium shadow-lg border border-[var(--border)] pointer-events-none z-10 animate-[fadeIn_0.15s_ease-out]">
          {t.terminal_copied}
        </div>
      )}

      {contextMenu &&
        createPortal(
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={[
              {
                label: "1×1",
                active: terminal.span.cols === 1 && terminal.span.rows === 1,
                onClick: () => onSpanChange?.({ cols: 1, rows: 1 }),
              },
              {
                label: "2×1 Wide",
                active: terminal.span.cols === 2 && terminal.span.rows === 1,
                onClick: () => onSpanChange?.({ cols: 2, rows: 1 }),
              },
              {
                label: "1×2 Tall",
                active: terminal.span.cols === 1 && terminal.span.rows === 2,
                onClick: () => onSpanChange?.({ cols: 1, rows: 2 }),
              },
              {
                label: "2×2 Large",
                active: terminal.span.cols === 2 && terminal.span.rows === 2,
                onClick: () => onSpanChange?.({ cols: 2, rows: 2 }),
              },
            ]}
            onClose={() => setContextMenu(null)}
          />,
          document.body,
        )}
    </div>
  );
}
