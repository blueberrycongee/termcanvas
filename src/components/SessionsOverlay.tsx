import { useEffect, useRef, useState } from "react";
import {
  useCanvasStore,
  COLLAPSED_TAB_WIDTH,
  PIN_DRAWER_WIDTH,
} from "../stores/canvasStore";
import { usePinStore } from "../stores/pinStore";
import { useSessionStore } from "../stores/sessionStore";
import {
  PANEL_TRANSITION_DURATION_MS,
  PANEL_TRANSITION_EASING_CSS,
} from "../utils/panelAnimation";
import { useT } from "../i18n/useT";
import { SessionReplayView } from "./SessionReplayView";

/*
 * Session replay drawer — left-anchored.
 *
 * The list side of the old SessionsOverlay moved to the LEFT panel's
 * HistorySection: clicking a past session row there calls
 * openSessionsOverlay + loadReplay, and this drawer slides out from
 * the right edge of the left panel to show the transcript.
 *
 * Geometry mirrors FileEditorDrawer but anchored left:
 *   level-1: min(60vw, canvas-gap) — replay + other surfaces visible
 *   level-2: full canvas-gap — immersive read mode
 *
 * Both levels leave the right panel (Files/Diff/Git/Memory) visible,
 * so the user can cross-reference code against the replay.
 *
 * Sits in the same canvas-gap "slot" as Usage and FileEditorDrawer —
 * canvasStore enforces mutual exclusion so opening one closes the
 * others.
 */

const TOOLBAR_HEIGHT = 44;

/**
 * Below this gap width the drawer is too cramped to read. Matches
 * UsageOverlay's auto-hide threshold so the three canvas-gap
 * tenants behave the same under tight layouts.
 */
const SESSIONS_MIN_GAP_PX = 640;

export function SessionsOverlay() {
  const open = useCanvasStore((s) => s.sessionsOverlayOpen);
  const expanded = useCanvasStore((s) => s.sessionsOverlayExpanded);
  const close = useCanvasStore((s) => s.closeSessionsOverlay);
  const toggleExpanded = useCanvasStore(
    (s) => s.toggleSessionsOverlayExpanded,
  );
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
  const taskDrawerOpen = usePinStore((s) => s.openProjectPath !== null);
  const replayTimeline = useSessionStore((s) => s.replayTimeline);
  const replayError = useSessionStore((s) => s.replayError);
  const t = useT();

  // Only animate width/left during the brief window after the user
  // toggles maximize/restore OR opens/closes the task drawer (which
  // shifts the canvas-gap by 320 px). Continuous geometry changes
  // (window resize, side-panel drag) would otherwise queue a 180ms
  // transition every frame and make the drawer chase the pointer.
  const [animateLayout, setAnimateLayout] = useState(false);
  const prevExpandedRef = useRef(expanded);
  const prevTaskDrawerOpenRef = useRef(taskDrawerOpen);
  useEffect(() => {
    if (
      prevExpandedRef.current === expanded &&
      prevTaskDrawerOpenRef.current === taskDrawerOpen
    ) {
      return;
    }
    prevExpandedRef.current = expanded;
    prevTaskDrawerOpenRef.current = taskDrawerOpen;
    setAnimateLayout(true);
    const timer = setTimeout(
      () => setAnimateLayout(false),
      PANEL_TRANSITION_DURATION_MS + 40,
    );
    return () => clearTimeout(timer);
  }, [expanded, taskDrawerOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // No second step any more — the list lives in the left panel
        // and stays visible regardless. Esc just closes the replay.
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open) return null;

  const leftInset =
    (leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth) +
    (taskDrawerOpen ? PIN_DRAWER_WIDTH : 0);
  const rightInset = rightPanelCollapsed
    ? COLLAPSED_TAB_WIDTH
    : rightPanelWidth;

  // Auto-hide when canvas gap is too narrow — same contract as
  // UsageOverlay. Store state stays open, so shrinking the side
  // panels brings the drawer back instantly.
  if (
    typeof window !== "undefined" &&
    window.innerWidth - leftInset - rightInset < SESSIONS_MIN_GAP_PX
  ) {
    return null;
  }

  const gapMax = `calc(100vw - ${leftInset}px - ${rightInset}px)`;
  const widthStyle = expanded ? gapMax : `min(60vw, ${gapMax})`;

  const hasReplay = replayTimeline !== null || replayError !== null;

  return (
    <div
      className="fixed z-[55] bg-[var(--bg)] border-l border-r border-[var(--border)] shadow-2xl flex flex-col usage-overlay-enter"
      style={{
        top: TOOLBAR_HEIGHT,
        left: leftInset,
        height: `calc(100vh - ${TOOLBAR_HEIGHT}px)`,
        width: widthStyle,
        transition: animateLayout
          ? `width ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}, left ${PANEL_TRANSITION_DURATION_MS}ms ${PANEL_TRANSITION_EASING_CSS}`
          : undefined,
      }}
      role="dialog"
      aria-modal="false"
      aria-label={t.sessions_tab}
    >
      {/* Header */}
      <div className="tc-row-divider shrink-0 flex items-center gap-2 px-3 py-2 bg-[var(--surface)]">
        <span className="tc-eyebrow tc-mono tc-color-primary">
          {t.sessions_tab}
        </span>
        <div className="flex-1" />
        <span className="tc-caption tc-mono">Esc</span>
        <button
          className="tc-row-icon flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
          onClick={toggleExpanded}
          title={
            expanded
              ? t.file_editor_restore ?? "Restore"
              : t.file_editor_maximize ?? "Maximize"
          }
        >
          {expanded ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect
                x="3.5"
                y="1.5"
                width="6"
                height="6"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.1"
              />
              <rect
                x="1.5"
                y="4.5"
                width="6"
                height="6"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.1"
                fill="var(--surface)"
              />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect
                x="1.5"
                y="1.5"
                width="9"
                height="9"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1.1"
              />
            </svg>
          )}
        </button>
        <button
          className="tc-row-icon flex items-center justify-center w-6 h-6 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
          onClick={close}
          aria-label={t.right_panel_collapse}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        {hasReplay ? (
          <SessionReplayView />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 px-8 text-center">
            <div className="tc-body-sm" style={{ color: "var(--text-muted)" }}>
              {(t.sessions_overlay_empty_title as unknown as string) ??
                "Pick a session on the left"}
            </div>
            <div className="tc-label max-w-sm leading-relaxed">
              {(t.sessions_overlay_empty_hint as unknown as string) ??
                "Browse past conversations in the left panel's History section. Click any row to replay the full transcript here."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
