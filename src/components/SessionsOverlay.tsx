import { useEffect } from "react";
import { useCanvasStore } from "../stores/canvasStore";
import { useSessionStore } from "../stores/sessionStore";
import { useT } from "../i18n/useT";
import { SessionsPanel } from "./SessionsPanel";
import { SessionReplayView } from "./SessionReplayView";

/*
 * Sessions, full-screen.
 *
 * Replaces the right-panel home for the sessions list and replay
 * view. Layout is a split pane:
 *
 *   ┌──────────────────────┬─────────────────────────────────────┐
 *   │ Live + projects +    │                                     │
 *   │ history list         │        SessionReplayView            │
 *   │ (≈360 px)            │        (flex-1, wide for prose)     │
 *   │                      │                                     │
 *   │                      │   OR empty state when nothing is    │
 *   │                      │   loaded yet.                       │
 *   └──────────────────────┴─────────────────────────────────────┘
 *
 * Rationale: the previous right-panel UX made "browse the history"
 * and "read a transcript" mutually exclusive — opening a replay
 * took over the entire narrow column, and going back to the list
 * meant closing the replay. A split pane lets the user click
 * around different sessions without losing context, and gives the
 * replay the width it actually needs to read comfortably.
 *
 * The list side reuses `<SessionsPanel stayInListMode />`, which
 * otherwise self-swaps into replay mode when a session is loaded.
 * In the overlay we want the list to stay mounted so the user can
 * pick another session from it.
 */

export function SessionsOverlay() {
  const open = useCanvasStore((s) => s.sessionsOverlayOpen);
  const close = useCanvasStore((s) => s.closeSessionsOverlay);
  const replayTimeline = useSessionStore((s) => s.replayTimeline);
  const replayError = useSessionStore((s) => s.replayError);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // If a replay is loaded, first Esc pops it back to "no
        // selection"; a second Esc closes the overlay. Matches how
        // most two-pane readers handle it (Mail, Slack search,
        // etc.) — "Esc = step back one level".
        if (replayTimeline || replayError) {
          useSessionStore.getState().exitReplay();
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close, replayTimeline, replayError]);

  if (!open) return null;

  const hasReplay = replayTimeline !== null || replayError !== null;

  return (
    <div
      className="fixed inset-0 z-[60] flex usage-overlay-enter"
      role="dialog"
      aria-modal="true"
      aria-label={t.sessions_tab}
      onClick={close}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[var(--bg)]/85 backdrop-blur-sm"
      />

      {/* Main container */}
      <div
        className="relative flex flex-1 m-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: list pane */}
        <div className="w-[360px] shrink-0 flex flex-col border-r border-[var(--border)] bg-[var(--sidebar)]">
          <div className="shrink-0 flex items-center border-b border-[var(--border)] h-[34px] px-3">
            <span
              className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-primary)] font-medium"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {t.sessions_tab}
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <SessionsPanel stayInListMode />
          </div>
        </div>

        {/* Right: replay pane */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 flex items-center justify-end border-b border-[var(--border)] h-[34px] px-3 gap-2">
            <span
              className="text-[10px] text-[var(--text-faint)]"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              Esc
            </span>
            <button
              type="button"
              onClick={close}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              aria-label={t.right_panel_collapse}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 3l6 6M9 3l-6 6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {hasReplay ? (
              <SessionReplayView />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2 px-8 text-center">
                <div className="text-[13px] text-[var(--text-muted)]">
                  {(t.sessions_overlay_empty_title as unknown as string) ??
                    "Pick a session on the left"}
                </div>
                <div className="text-[11px] text-[var(--text-faint)] max-w-sm leading-relaxed">
                  {(t.sessions_overlay_empty_hint as unknown as string) ??
                    "Browse live or past conversations in the list. Click any row to replay the full transcript here."}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
