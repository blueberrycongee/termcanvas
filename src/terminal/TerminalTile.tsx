import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { TerminalData } from "../types";
import { activateTerminalInScene } from "../actions/sceneSelectionActions";
import {
  closeTerminalInScene,
  stashTerminalInScene,
  toggleTerminalMinimizeInScene,
  toggleTerminalStarredInScene,
  updateTerminalCustomTitleInScene,
} from "../actions/terminalSceneActions";
import {
  useProjectStore,
  findTerminalById,
  getChildTerminals,
} from "../stores/projectStore";
import { ContextMenu } from "../components/ContextMenu";
import { TagManager } from "./TagManager";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useCanvasStore } from "../stores/canvasStore";
import { getTerminalHeaderContextLabel } from "../stores/terminalState";
import { useResolvedTerminalRuntimeState } from "../stores/terminalRuntimeStateStore";
import { useT } from "../i18n/useT";
import { getComposerAdapter } from "./cliConfig";
import { panToTerminal } from "../utils/panToTerminal";
import { panToWorktree } from "../utils/panToWorktree";
import { focusWorktreeInScene } from "../actions/sceneSelectionActions";
import { requestSummary, useIsSummarizing } from "./summaryScheduler";
import {
  attachTerminalContainer,
  blurTerminalRuntime,
  detachTerminalContainer,
  fitTerminalRuntime,
  focusTerminalRuntime,
  getTerminalPtyId,
  getTerminalRuntime,
  touchTerminalRuntime,
  useTerminalRuntimeStore,
} from "./terminalRuntimeStore";
import type { TerminalMountMode } from "./terminalRuntimePolicy";
import { shellEscapePath } from "../utils/shellEscape";
import {
  cancelScheduledTerminalFocus,
  scheduleTerminalFocus,
} from "./focusScheduler";
import { useSidebarDragStore } from "../stores/sidebarDragStore";
import { usePinDragStore } from "../stores/pinDragStore";
import { usePinStore } from "../stores/pinStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useViewportFocusStore } from "../stores/viewportFocusStore";
import { TERMINAL_TYPE_CONFIG } from "./terminalTypeConfig";
import { AgentRenderer } from "../components/agent/AgentRenderer";
import { recordRenderDiagnostic } from "./renderDiagnostics";

interface Props {
  lodMode: TerminalMountMode;
  projectId: string;
  worktreeId: string;
  worktreeName: string;
  worktreePath: string;
  terminal: TerminalData;
  width: number;
  height: number;
}

const TYPE_CONFIG = TERMINAL_TYPE_CONFIG;

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
            <path
              d="M6 9V3M3 5l3-3 3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
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
            <path
              d="M6 2v4M3 4v4M9 4v4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
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
  const label = lodMode === "evicted" ? "Fallback" : "Parked";
  const body =
    previewText.trim().length > 0
      ? previewText
      : lodMode === "evicted"
        ? "Live renderer evicted. Showing buffered fallback only."
        : "Live terminal parked offscreen. The real xterm resumes when this tile becomes visible again.";

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
            {lodMode === "evicted"
              ? "preview fallback"
              : "live xterm preserved"}
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

export function TerminalTile({
  lodMode,
  projectId,
  worktreeId,
  worktreeName,
  worktreePath,
  terminal,
  width,
  height,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [tagManager, setTagManager] = useState<{
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
  const settledFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);
  const pendingFocusFrameRef = useRef<number | null>(null);
  const customTitleInputRef = useRef<HTMLInputElement>(null);
  const copiedNonce = useTerminalRuntimeStore(
    (s) => s.terminals[terminal.id]?.copiedNonce ?? 0,
  );
  const mountNonceRef = useRef(copiedNonce);
  const previewText = useTerminalRuntimeStore(
    (s) => s.terminals[terminal.id]?.previewText ?? "",
  );
  const [dragOver, setDragOver] = useState(false);
  const agentBodyRef = useRef<HTMLDivElement>(null);
  const [agentBodySize, setAgentBodySize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const isAgent = terminal.type === "claude" || terminal.type === "codex";
  const useAgentRenderer = false; // TODO: re-enable when agent renderer is ready
  const latestLodModeRef = useRef(lodMode);
  const latestContainerElRef = useRef<HTMLDivElement | null>(containerEl);
  latestLodModeRef.current = lodMode;
  latestContainerElRef.current = containerEl;
  const isSummarizing = useIsSummarizing(terminal.id);
  const sidebarDragActive = useSidebarDragStore((s) => s.active);
  const taskDragActive = usePinDragStore((s) => s.active);
  const terminalTaskAssignment = usePinStore(
    (s) => s.terminalPinMap[terminal.id],
  );
  const [taskFlash, setTaskFlash] = useState(false);
  const taskFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerAdapter = getComposerAdapter(terminal.type);
  const acceptsTaskDrop = composerAdapter !== null;
  const viewportScale = useCanvasStore((s) => s.viewport.scale);
  const zoomedOutTerminalId = useViewportFocusStore(
    (s) => s.zoomedOutTerminalId,
  );
  const fitAllScale = useViewportFocusStore((s) => s.fitAllScale);
  const isOverviewMode =
    fitAllScale !== null &&
    zoomedOutTerminalId !== null &&
    viewportScale <= fitAllScale * 1.2;
  const liveRuntimeState = useResolvedTerminalRuntimeState(terminal);
  const liveTerminal = {
    ...terminal,
    ...liveRuntimeState,
  };

  const [frozenDims, setFrozenDims] = useState<{
    width: number;
    height: number;
    bgColor: string;
  } | null>(null);

  const t = useT();
  const config = TYPE_CONFIG[terminal.type] ?? {
    color: "#888",
    label: terminal.type,
  };
  const headerContextLabel = getTerminalHeaderContextLabel(
    worktreeName,
    terminal.title,
  );
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
    updateTerminalCustomTitleInScene(
      projectId,
      worktreeId,
      terminal.id,
      customTitleDraft,
    );
    setIsEditingCustomTitle(false);
  }, [customTitleDraft, projectId, terminal.id, worktreeId]);

  const zoomIntoTerminalFromOverview = useCallback(() => {
    activateTerminalInScene(projectId, worktreeId, terminal.id);
    panToTerminal(terminal.id);
    useViewportFocusStore.getState().setZoomedOutTerminalId(null);
  }, [projectId, terminal.id, worktreeId]);

  const focusTerminalInOverview = useCallback(() => {
    activateTerminalInScene(projectId, worktreeId, terminal.id);
    useViewportFocusStore.getState().setZoomedOutTerminalId(terminal.id);
  }, [projectId, terminal.id, worktreeId]);

  useEffect(() => {
    if (!isEditingCustomTitle) return;

    requestAnimationFrame(() => {
      customTitleInputRef.current?.focus();
      customTitleInputRef.current?.select();
    });
  }, [isEditingCustomTitle]);

  useEffect(() => {
    // Skip the initial mount — only show the toast when the nonce actually
    // increments after the component is alive.  Without this guard, terminals
    // re-mounted by React Flow's onlyRenderVisibleElements (e.g. after
    // cmd+e zoom-to-fit) would re-flash the "Copied" toast for every
    // terminal that was copied in the past.
    if (copiedNonce === 0 || copiedNonce === mountNonceRef.current) {
      mountNonceRef.current = copiedNonce;
      return;
    }
    mountNonceRef.current = copiedNonce;

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
      if (settledFitTimerRef.current) {
        clearTimeout(settledFitTimerRef.current);
      }
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
      if (taskFlashTimerRef.current) {
        clearTimeout(taskFlashTimerRef.current);
      }
    },
    [],
  );

  useEffect(
    () => () => {
      recordRenderDiagnostic({
        kind: "terminal_tile_unmount",
        terminalId: terminal.id,
        data: {
          had_container: latestContainerElRef.current !== null,
          lod_mode: latestLodModeRef.current,
          use_agent_renderer: useAgentRenderer,
        },
      });
    },
    [terminal.id, useAgentRenderer],
  );

  useEffect(() => {
    if (lodMode !== "live" || !containerEl || useAgentRenderer) {
      return;
    }

    attachTerminalContainer(terminal.id, containerEl);
    return () => {
      detachTerminalContainer(terminal.id, {
        caller: "TerminalTile.liveEffect",
        detail: {
          container_present: !!containerEl,
          lod_mode: lodMode,
          use_agent_renderer: useAgentRenderer,
        },
        reason: "terminal_tile_live_effect_cleanup",
      });
    };
  }, [lodMode, terminal.id, useAgentRenderer, containerEl]);

  useEffect(() => {
    if (!useAgentRenderer) return;
    const el = agentBodyRef.current;
    if (!el) return;
    let rafId = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setAgentBodySize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [useAgentRenderer]);

  useEffect(() => {
    if (terminal.minimized || lodMode !== "live") return;
    if (useAgentRenderer) return;
    if (isAgent && sidebarDragActive) return;

    const frame = requestAnimationFrame(() => {
      fitTerminalRuntime(terminal.id);
    });

    return () => cancelAnimationFrame(frame);
  }, [
    height,
    isAgent,
    lodMode,
    sidebarDragActive,
    terminal.id,
    terminal.minimized,
    useAgentRenderer,
    width,
  ]);

  useEffect(() => {
    const tile = tileRef.current;
    if (!tile) return;

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== tile) return;
      if (event.propertyName !== "width" && event.propertyName !== "height") {
        return;
      }
      if (terminal.minimized || lodMode !== "live") return;
      if (useAgentRenderer) return;
      if (isAgent && useSidebarDragStore.getState().active) return;

      requestAnimationFrame(() => {
        fitTerminalRuntime(terminal.id);
      });
    };

    tile.addEventListener("transitionend", handleTransitionEnd);
    return () => {
      tile.removeEventListener("transitionend", handleTransitionEnd);
    };
  }, [isAgent, lodMode, terminal.id, terminal.minimized, useAgentRenderer]);

  useEffect(() => {
    if (!containerEl) return;

    const scheduleSettledFit = () => {
      if (settledFitTimerRef.current) {
        clearTimeout(settledFitTimerRef.current);
      }

      settledFitTimerRef.current = setTimeout(() => {
        settledFitTimerRef.current = null;
        if (terminal.minimized || lodMode !== "live") return;
        if (useAgentRenderer) return;
        if (isAgent && useSidebarDragStore.getState().active) return;

        requestAnimationFrame(() => {
          fitTerminalRuntime(terminal.id);
        });
      }, 120);
    };

    const observer = new ResizeObserver(() => {
      scheduleSettledFit();
    });

    observer.observe(containerEl);
    return () => {
      observer.disconnect();
      if (settledFitTimerRef.current) {
        clearTimeout(settledFitTimerRef.current);
        settledFitTimerRef.current = null;
      }
    };
  }, [
    containerEl,
    isAgent,
    lodMode,
    terminal.id,
    terminal.minimized,
    useAgentRenderer,
  ]);

  useEffect(() => {
    if (!isAgent || !sidebarDragActive) {
      setFrozenDims(null);
      return;
    }
    if (!containerEl) return;

    const bgColor =
      getTerminalRuntime(terminal.id)?.xterm?.options.theme?.background ??
      "#1e1e1e";

    setFrozenDims({
      width: containerEl.offsetWidth,
      height: containerEl.offsetHeight,
      bgColor,
    });
  }, [isAgent, sidebarDragActive, terminal.id, containerEl]);

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
      lodMode === "live" && terminal.focused && (!adapter || !composerEnabled);

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
    if (!containerEl || lodMode !== "live") return;

    const corrected = new WeakSet<Event>();

    const fix = (e: MouseEvent) => {
      if (corrected.has(e)) return;

      // While the user is actively panning the canvas with the hand tool,
      // skip all xterm mouse-event correction. The pointer is dragging the
      // viewport, not interacting with terminal content, so the expensive
      // getBoundingClientRect() work is wasted and forces synchronous layout
      // on every mousemove frame — a major source of jank during pan.
      if (document.body.classList.contains("tc-canvas-pan-grabbing")) return;

      if (
        isOverviewMode &&
        (e.type === "mousedown" ||
          e.type === "mouseup" ||
          e.type === "click" ||
          e.type === "dblclick")
      ) {
        e.stopPropagation();
        e.preventDefault();
        if (e.type === "click" && e.detail === 1) {
          focusTerminalInOverview();
        } else if (e.type === "dblclick") {
          zoomIntoTerminalFromOverview();
        }
        return;
      }
      const { scale } = useCanvasStore.getState().viewport;
      if (scale === 1) return;

      // xterm computes selection coordinates from `.xterm-screen`, not the
      // outer host div. When the canvas is zoomed, even a tiny mismatch between
      // the host hitbox and xterm's actual screen area expands into a visible
      // dead zone near the top-left. Measure against the real screen element
      // and, if the pointer lands in a host/gap area, re-dispatch to the xterm
      // root so selection still starts inside xterm.
      const xtermRoot = containerEl.querySelector(".xterm");
      const screenElement =
        containerEl.querySelector(".xterm-screen") ?? xtermRoot ?? containerEl;
      const rect = screenElement.getBoundingClientRect();
      const dispatchTarget =
        e.target instanceof Element &&
        xtermRoot instanceof Element &&
        xtermRoot.contains(e.target)
          ? e.target
          : (xtermRoot ?? containerEl);
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
      dispatchTarget.dispatchEvent(adjusted);
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
      const target = e.target instanceof Element ? e.target : containerEl;
      target.setPointerCapture(e.pointerId);
    };

    // Stop mousedown from bubbling past the container so it never reaches
    // the Canvas pan handler.  Without this, every click inside the terminal
    // content area also starts a canvas pan, fighting xterm's selection.
    // At scale != 1 the corrected event also needs to be caught; at scale 1
    // the original native event needs to be caught.
    const stopMouseDownBubble = (e: MouseEvent) => {
      e.stopPropagation();
    };

    const types = ["mousedown", "mousemove", "mouseup", "click", "dblclick"];
    for (const type of types) {
      containerEl.addEventListener(type, fix as EventListener, true);
    }
    containerEl.addEventListener("mousedown", stopMouseDownBubble);
    containerEl.addEventListener("pointerdown", capturePointer);

    return () => {
      for (const type of types) {
        containerEl.removeEventListener(type, fix as EventListener, true);
      }
      containerEl.removeEventListener("mousedown", stopMouseDownBubble);
      containerEl.removeEventListener("pointerdown", capturePointer);
    };
  }, [
    containerEl,
    focusTerminalInOverview,
    isOverviewMode,
    lodMode,
    zoomIntoTerminalFromOverview,
  ]);

  const flashTaskAccept = useCallback(() => {
    setTaskFlash(true);
    if (taskFlashTimerRef.current) clearTimeout(taskFlashTimerRef.current);
    taskFlashTimerRef.current = setTimeout(() => {
      setTaskFlash(false);
      taskFlashTimerRef.current = null;
    }, 350);
  }, []);

  const handleTaskDropPayload = useCallback(
    async (raw: string) => {
      let parsed: { repo: string; id: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!parsed?.repo || !parsed?.id) return;

      const ptyId = getTerminalPtyId(terminal.id);
      if (ptyId === null) {
        useNotificationStore
          .getState()
          .notify("warn", t["pin.dispatch.terminalNotRunning"]);
        return;
      }
      if (!composerAdapter) {
        useNotificationStore
          .getState()
          .notify(
            "warn",
            t["pin.dispatch.unsupportedTerminal"](terminal.type),
          );
        return;
      }

      activateTerminalInScene(projectId, worktreeId, terminal.id);

      try {
        const result = await window.termcanvas.pins.dispatchToTerminal(
          parsed.repo,
          parsed.id,
          {
            terminalId: terminal.id,
            ptyId,
            terminalType: terminal.type,
            worktreePath,
          },
        );
        if (result.ok) {
          // Record the terminal ↔ pin association for the badge. Look the
          // full pin up so we cache its current title; if the project
          // drawer is closed for some reason (rare race) fall back to a
          // placeholder title — the entry still resolves visually.
          const pinState = usePinStore.getState();
          const fullPin = (pinState.pinsByProject[parsed.repo] ?? []).find(
            (entry) => entry.id === parsed.id,
          );
          pinState.assignPinToTerminal(
            terminal.id,
            fullPin ?? {
              id: parsed.id,
              repo: parsed.repo,
              title: t["pin.untitled"],
            },
          );
          flashTaskAccept();
        } else {
          useNotificationStore
            .getState()
            .notify(
              "error",
              t["pin.dispatch.failed"](
                result.detail ?? result.error ?? "unknown",
              ),
            );
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        useNotificationStore
          .getState()
          .notify("error", t["pin.dispatch.failed"](detail));
      }
    },
    [
      composerAdapter,
      flashTaskAccept,
      projectId,
      t,
      terminal.id,
      terminal.type,
      worktreeId,
      worktreePath,
    ],
  );

  // Intercept drag events on the xterm container in the capture phase so they
  // are not swallowed by xterm's own handlers.
  useEffect(() => {
    const container = containerEl;
    if (!container || lodMode !== "live") return;

    const isTaskDrag = (e: DragEvent) =>
      !!e.dataTransfer &&
      Array.from(e.dataTransfer.types).includes(
        "application/x-termcanvas-pin",
      );

    const onDragOver = (e: DragEvent) => {
      if (isTaskDrag(e) && !acceptsTaskDrop) return;
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
      if (isTaskDrag(e)) {
        if (!acceptsTaskDrop) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const raw = e.dataTransfer?.getData("application/x-termcanvas-pin");
        if (raw) void handleTaskDropPayload(raw);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const rawPath = e.dataTransfer?.getData("text/plain");
      if (!rawPath) return;

      const ptyId = getTerminalPtyId(terminal.id);
      if (ptyId === null) return;

      const escaped = rawPath.split("\n").filter(Boolean).map(shellEscapePath).join(" ");
      window.termcanvas.terminal.input(ptyId, " " + escaped);
      activateTerminalInScene(projectId, worktreeId, terminal.id);
    };

    container.addEventListener("dragover", onDragOver, true);
    container.addEventListener("dragleave", onDragLeave, true);
    container.addEventListener("drop", onDrop, true);

    return () => {
      container.removeEventListener("dragover", onDragOver, true);
      container.removeEventListener("dragleave", onDragLeave, true);
      container.removeEventListener("drop", onDrop, true);
    };
  }, [
    containerEl,
    lodMode,
    projectId,
    terminal.id,
    worktreeId,
    acceptsTaskDrop,
    handleTaskDropPayload,
  ]);

  const handleClose = useCallback(() => {
    closeTerminalInScene(projectId, worktreeId, terminal.id);
  }, [projectId, terminal.id, worktreeId]);

  const isTaskDragEvent = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("application/x-termcanvas-pin");

  const handleTileDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isTaskDragEvent(e) && !acceptsTaskDrop) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    },
    [acceptsTaskDrop],
  );

  const handleTileDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleTileDrop = useCallback(
    (e: React.DragEvent) => {
      if (isTaskDragEvent(e)) {
        if (!acceptsTaskDrop) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const raw = e.dataTransfer.getData("application/x-termcanvas-pin");
        if (raw) void handleTaskDropPayload(raw);
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const rawPath = e.dataTransfer.getData("text/plain");
      if (!rawPath) return;

      const ptyId = getTerminalPtyId(terminal.id);
      if (ptyId === null) return;

      const escaped = rawPath.split("\n").filter(Boolean).map(shellEscapePath).join(" ");
      window.termcanvas.terminal.input(ptyId, " " + escaped);
      activateTerminalInScene(projectId, worktreeId, terminal.id);
    },
    [
      acceptsTaskDrop,
      handleTaskDropPayload,
      projectId,
      terminal.id,
      worktreeId,
    ],
  );

  return (
    <div
      ref={tileRef}
      onDragOver={handleTileDragOver}
      onDragLeave={handleTileDragLeave}
      onDrop={handleTileDrop}
      className="terminal-tile rounded-md border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col h-full w-full"
      style={{
        width: width,
        height: terminal.minimized ? "auto" : height,
        boxShadow:
          dragOver || taskFlash
            ? "0 0 0 2px var(--accent), 0 0 12px color-mix(in srgb, var(--accent) 25%, transparent)"
            : taskDragActive && acceptsTaskDrop
              ? "0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent)"
              : terminal.focused
                ? isOverviewMode
                  ? "0 0 0 2px color-mix(in srgb, var(--text-secondary) 45%, transparent), inset 0 2px 0 0 color-mix(in srgb, var(--text-secondary) 25%, transparent)"
                  : "inset 0 2px 0 0 color-mix(in srgb, var(--text-secondary) 25%, transparent)"
                : undefined,
        borderColor:
          !dragOver && !taskFlash && terminal.focused
            ? "var(--border-hover)"
            : undefined,
        outline: "none",
        transition: "box-shadow 150ms ease",
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (isOverviewMode) {
          focusTerminalInOverview();
          return;
        }
        activateTerminalInScene(projectId, worktreeId, terminal.id, {
          focusInput: false,
        });
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isOverviewMode) return;
        zoomIntoTerminalFromOverview();
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
        className="relative flex items-center gap-2 px-3 py-2 select-none shrink-0"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (isOverviewMode) {
            zoomIntoTerminalFromOverview();
            return;
          }
          panToTerminal(terminal.id);
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
          className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--border)] rounded px-1 py-0.5 transition-colors duration-150 cursor-pointer"
          style={{ fontFamily: '"Geist Mono", monospace' }}
          title={headerContextLabel}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            focusWorktreeInScene(projectId, worktreeId);
            panToWorktree(projectId, worktreeId, { enterOverview: true });
            const canvas = useCanvasStore.getState();
            canvas.setRightPanelCollapsed(false);
            canvas.setRightPanelActiveTab("files");
          }}
        >
          {headerContextLabel}
        </span>
        <div
          className={`h-6 min-w-0 flex-1 rounded-md border px-1.5 text-[11px] ${
            terminal.customTitle
              ? "border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]"
              : "border-dashed border-[var(--border)] bg-[var(--bg)] text-[var(--text-faint)]"
          }`}
          style={{ fontFamily: '"Geist Mono", monospace' }}
          title={terminal.customTitle || t.terminal_custom_title_placeholder}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (isOverviewMode) {
              zoomIntoTerminalFromOverview();
              return;
            }
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
                toggleTerminalStarredInScene(
                  projectId,
                  worktreeId,
                  terminal.id,
                );
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden="true"
              >
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
            ) : isSummarizing ? (
              <span className="min-w-0 flex-1 truncate leading-[22px] animate-pulse text-[var(--text-faint)]">
                {t.summary_in_progress}
              </span>
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
              toggleTerminalMinimizeInScene(projectId, worktreeId, terminal.id);
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

      {terminalTaskAssignment && (
        <div className="shrink-0 flex items-center px-3 pb-1.5 -mt-1">
          <button
            type="button"
            className="group/badge inline-flex items-center gap-1 max-w-[200px] px-1.5 py-0.5 rounded-sm text-[10px] leading-none cursor-pointer bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/25 hover:border-[var(--accent)]/45 transition-colors duration-150"
            title={t["pin.terminalBadge.tooltip"](
              terminalTaskAssignment.title,
            )}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const pinState = usePinStore.getState();
              pinState.openDrawer(terminalTaskAssignment.repo);
              pinState.openDetail(terminalTaskAssignment.pinId);
            }}
          >
            <span aria-hidden="true" className="shrink-0">
              ▸
            </span>
            <span className="truncate">{terminalTaskAssignment.title}</span>
          </button>
        </div>
      )}

      {useAgentRenderer ? (
        <div
          ref={agentBodyRef}
          className={
            terminal.minimized
              ? "relative nopan nodrag nowheel"
              : "flex-1 min-h-0 relative nopan nodrag nowheel"
          }
          style={{
            height: terminal.minimized ? 0 : undefined,
            overflow: "hidden",
          }}
        >
          {!terminal.minimized && agentBodySize && (
            <AgentRenderer
              terminalId={terminal.id}
              sessionId={terminal.id}
              resumeSessionId={liveTerminal.sessionId}
              projectId={projectId}
              worktreeId={worktreeId}
              cwd={worktreePath}
              width={agentBodySize.width}
              height={agentBodySize.height}
            />
          )}
        </div>
      ) : lodMode === "live" ? (
        <div
          className={
            terminal.minimized
              ? "relative nopan nodrag nowheel"
              : "flex-1 min-h-0 relative nopan nodrag nowheel"
          }
          style={{
            height: terminal.minimized ? 0 : undefined,
            overflow: "hidden",
            backgroundColor: frozenDims?.bgColor,
          }}
        >
          <div
            ref={containerRef}
            className={
              frozenDims
                ? "absolute tc-xterm-host nopan nodrag nowheel"
                : "absolute inset-0 tc-xterm-host nopan nodrag nowheel"
            }
            style={{
              padding: 0,
              overflow: "hidden",
              ...(frozenDims
                ? {
                    top: 0,
                    left: 0,
                    width: frozenDims.width,
                    height: frozenDims.height,
                  }
                : undefined),
            }}
            onClick={(e) => {
              if (isOverviewMode) {
                e.stopPropagation();
                focusTerminalInOverview();
                return;
              }
              const adapter = getComposerAdapter(terminal.type);
              if (
                !adapter ||
                adapter.inputMode === "type" ||
                !composerEnabled
              ) {
                scheduleXtermFocus();
              } else {
                window.dispatchEvent(
                  new CustomEvent("termcanvas:focus-composer"),
                );
              }
            }}
          />
        </div>
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
                label: t.stash_terminal,
                onClick: () =>
                  stashTerminalInScene(projectId, worktreeId, terminal.id),
              },
              {
                label: "Tags…",
                onClick: () =>
                  setTagManager({ x: contextMenu.x, y: contextMenu.y }),
              },
              ...((terminal.type === "claude" || terminal.type === "codex") &&
              liveTerminal.sessionId
                ? [
                    {
                      label: t.summarize_terminal,
                      onClick: () =>
                        requestSummary(
                          projectId,
                          worktreeId,
                          worktreePath,
                          liveTerminal,
                          usePreferencesStore.getState().summaryCli,
                        ),
                    },
                  ]
                : []),
            ]}
            onClose={() => setContextMenu(null)}
          />,
          document.body,
        )}

      {tagManager &&
        createPortal(
          <TagManager
            projectId={projectId}
            worktreeId={worktreeId}
            terminalId={terminal.id}
            clientX={tagManager.x}
            clientY={tagManager.y}
            onClose={() => setTagManager(null)}
          />,
          document.body,
        )}
    </div>
  );
}
