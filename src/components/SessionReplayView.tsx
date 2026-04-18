import { useEffect, useRef, useCallback, useMemo } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useT } from "../i18n/useT";
import type { TimelineEvent } from "../../shared/sessions";
import { useProjectStore } from "../stores/projectStore";
import { useNotificationStore } from "../stores/notificationStore";
import { createTerminalInScene } from "../actions/terminalSceneActions";
import { createTerminal } from "../stores/projectStore";
import { panToTerminal } from "../utils/panToTerminal";
import type { TerminalType } from "../types";

const EVENT_ICONS: Record<TimelineEvent["type"], string> = {
  user_prompt: "▶",
  assistant_text: "◆",
  thinking: "◌",
  tool_use: "⚙",
  tool_result: "✓",
  turn_complete: "●",
  error: "✗",
};

const EVENT_COLORS: Record<TimelineEvent["type"], string> = {
  user_prompt: "var(--accent)",
  assistant_text: "var(--text-primary)",
  thinking: "var(--text-muted)",
  tool_use: "#f59e0b",
  tool_result: "#22c55e",
  turn_complete: "var(--text-faint)",
  error: "#ef4444",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function projectName(projectDir: string): string {
  const normalized = projectDir.replace(/\\/g, "/");
  if (normalized.includes("/")) {
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || projectDir;
  }
  return projectDir.replace(/^-/, "").split("-").pop() || projectDir;
}

function TimelineRow({
  event,
  isCurrent,
  onClick,
}: {
  event: TimelineEvent;
  isCurrent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`w-full px-2 py-1 flex items-start gap-1.5 text-left cursor-pointer rounded text-[10px] transition-colors ${
        isCurrent ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--sidebar-hover)]"
      }`}
      onClick={onClick}
    >
      <span className="shrink-0 w-3 text-center" style={{ color: EVENT_COLORS[event.type] }}>
        {EVENT_ICONS[event.type]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ color: isCurrent ? "var(--text-primary)" : "var(--text-secondary)" }}>
          {event.toolName ? `${event.toolName}` : event.type.replace("_", " ")}
          {event.filePath && (
            <span className="text-[var(--text-faint)]"> {event.filePath.split("/").pop()}</span>
          )}
        </div>
        {event.textPreview && (
          <div className="truncate text-[var(--text-faint)]">{event.textPreview}</div>
        )}
      </div>
      <span className="shrink-0 text-[var(--text-faint)] tabular-nums">
        {formatTimestamp(event.timestamp)}
      </span>
    </button>
  );
}

const SPEEDS = [1, 2, 4, 8];

/**
 * Infer the agent provider ("claude" | "codex" | …) from the path of
 * the session's JSONL file. Claude stores sessions under
 * `~/.claude/projects/**`; Codex under `~/.codex/sessions/**`. This
 * path-based detection keeps ReplayTimeline provider-agnostic so the
 * upstream scanner doesn't have to pipe one more field through.
 */
function providerFromFilePath(filePath: string): TerminalType | null {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/.claude/")) return "claude";
  if (normalized.includes("/.codex/")) return "codex";
  return null;
}

export function SessionReplayView() {
  const timeline = useSessionStore((s) => s.replayTimeline);
  const replayError = useSessionStore((s) => s.replayError);
  const currentIndex = useSessionStore((s) => s.replayCurrentIndex);
  const isPlaying = useSessionStore((s) => s.replayIsPlaying);
  const speed = useSessionStore((s) => s.replaySpeed);
  const exitReplay = useSessionStore((s) => s.exitReplay);
  const seekTo = useSessionStore((s) => s.seekTo);
  const stepForward = useSessionStore((s) => s.stepForward);
  const stepBackward = useSessionStore((s) => s.stepBackward);
  const togglePlayback = useSessionStore((s) => s.togglePlayback);
  const stopPlayback = useSessionStore((s) => s.stopPlayback);
  const setSpeed = useSessionStore((s) => s.setSpeed);
  const { notify } = useNotificationStore();
  const t = useT();

  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  // Resolve the replay's project/worktree from the canvas state. Only
  // worktrees with a path exactly matching the replay's `projectDir`
  // can host a Resume — we don't want to invent a worktree on the
  // user's behalf, and a close-but-not-exact match (e.g. the user
  // moved the project) would silently resume in the wrong place.
  //
  // Guard against the project not being on the canvas at all; in that
  // case the Resume button stays disabled with an explanatory tooltip
  // rather than being hidden — less surprising than a UI element that
  // only sometimes appears.
  const resumeTarget = useMemo(() => {
    if (!timeline) return null;
    const provider = providerFromFilePath(timeline.filePath);
    if (!provider) return null;
    const projects = useProjectStore.getState().projects;
    for (const project of projects) {
      for (const worktree of project.worktrees) {
        if (worktree.path === timeline.projectDir) {
          return {
            provider,
            projectId: project.id,
            worktreeId: worktree.id,
            sessionId: timeline.sessionId,
          };
        }
      }
    }
    return null;
  }, [timeline]);

  const handleResume = useCallback(() => {
    if (!resumeTarget) return;
    // Build a fresh terminal bound to this session. Runtime store
    // picks `sessionId` up in `spawnPty` and routes it through each
    // agent's `resumeArgs()` (`--resume <id>` for claude, `resume
    // <id>` for codex, etc. — see src/terminal/cliConfig.ts).
    const base = createTerminal(
      resumeTarget.provider,
      undefined,
      undefined,
      undefined,
      "user",
    );
    base.sessionId = resumeTarget.sessionId;

    const created = createTerminalInScene({
      projectId: resumeTarget.projectId,
      worktreeId: resumeTarget.worktreeId,
      terminal: base,
      origin: "user",
    });

    // Leave the replay immediately — the user's attention is on the
    // live terminal they just resumed into. Pan the canvas so that
    // terminal is centered & focused; also gives the user a clear
    // signal that the click went somewhere.
    exitReplay();
    panToTerminal(created.id);

    notify(
      "info",
      (t.session_replay_resume_toast as unknown as string) ??
        `Resumed session in new ${resumeTarget.provider} terminal`,
    );
  }, [resumeTarget, exitReplay, notify, t]);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIndex]);

  useEffect(() => {
    if (!isPlaying || !timeline) return;

    const events = timeline.events;
    if (currentIndex >= events.length - 1) {
      stopPlayback();
      return;
    }

    const current = events[currentIndex];
    const next = events[currentIndex + 1];
    const realDelta = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();
    const interval = Math.max(50, Math.min(2000, realDelta / speed));

    const timer = setTimeout(() => {
      stepForward();
    }, interval);

    return () => clearTimeout(timer);
  }, [isPlaying, currentIndex, speed, timeline, stepForward, stopPlayback]);

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!timeline) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      seekTo(Math.round(fraction * (timeline.events.length - 1)));
    },
    [timeline, seekTo],
  );

  if (!timeline) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2">
        {replayError ? (
          <>
            <div className="text-[11px] text-[#ef4444]">{replayError}</div>
            <button
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              onClick={exitReplay}
            >
              {t.sessions_load_error_back}
            </button>
          </>
        ) : (
          <div className="text-[11px] text-[var(--text-faint)]">{t.sessions_loading}</div>
        )}
      </div>
    );
  }

  const projectDir = timeline.projectDir;
  const progress = timeline.events.length > 1 ? currentIndex / (timeline.events.length - 1) : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-2 py-2 border-b border-[var(--border)] flex items-center gap-2">
        <button
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          onClick={exitReplay}
          title={(t.sessions_load_error_back as unknown as string) ?? "Back"}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8 1L3 6l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium truncate">
            {projectName(projectDir)}
          </div>
          <div className="text-[9px] text-[var(--text-faint)]">
            {timeline.events.length} {t.sessions_events} · {Math.round(timeline.totalTokens / 1000)}k {t.sessions_tokens}
          </div>
        </div>
        {/*
          Resume action. Small accent-coloured button with an inline
          glyph + label — the primary affordance of the replay view
          (read context → jump back into it), so it sits top-right
          where the user looks after finishing reading the header.
          Disabled state kicks in when the project isn't on the canvas
          (we refuse to invent a worktree on the user's behalf). The
          tooltip explains the disabled case so the button is still
          discoverable.
        */}
        <button
          className="shrink-0 inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            color: resumeTarget ? "var(--accent)" : "var(--text-muted)",
            backgroundColor: resumeTarget
              ? "color-mix(in srgb, var(--accent) 12%, transparent)"
              : "transparent",
          }}
          onClick={handleResume}
          disabled={!resumeTarget}
          title={
            resumeTarget
              ? ((t.session_replay_resume_tooltip as unknown as string) ??
                  `Resume in a new ${resumeTarget.provider} terminal (--resume ${resumeTarget.sessionId.slice(0, 8)})`)
              : ((t.session_replay_resume_unavailable as unknown as string) ??
                  "Add this project to the canvas to resume")
          }
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 1l6 4-6 4V1z" fill="currentColor" />
          </svg>
          <span>{(t.session_replay_resume as unknown as string) ?? "Resume"}</span>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-1 py-1">
        {timeline.events.map((event) => (
          <div key={event.index} ref={event.index === currentIndex ? currentRef : undefined}>
            <TimelineRow
              event={event}
              isCurrent={event.index === currentIndex}
              onClick={() => seekTo(event.index)}
            />
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-[var(--border)] px-2 py-1.5">
        <div
          className="h-1 bg-[var(--border)] rounded-full mb-1.5 cursor-pointer"
          onClick={handleProgressClick}
        >
          <div
            className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-75"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="flex items-center gap-1">
          <button className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" onClick={() => seekTo(0)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2v6M8 2L4 5l4 3V2z" fill="currentColor"/></svg>
          </button>
          <button className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" onClick={stepBackward}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M7 2L3 5l4 3V2z" fill="currentColor"/></svg>
          </button>
          <button className="p-1 text-[var(--text-primary)] cursor-pointer" onClick={togglePlayback}>
            {isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="2" width="3" height="8" rx="0.5" fill="currentColor"/><rect x="7" y="2" width="3" height="8" rx="0.5" fill="currentColor"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 1.5l7 4.5-7 4.5V1.5z" fill="currentColor"/></svg>
            )}
          </button>
          <button className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" onClick={stepForward}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 2l4 3-4 3V2z" fill="currentColor"/></svg>
          </button>
          <button className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer" onClick={() => seekTo(timeline.events.length - 1)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M8 2v6M2 2l4 3-4 3V2z" fill="currentColor"/></svg>
          </button>

          <div className="flex-1" />

          <button
            className="text-[9px] tabular-nums text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer px-1"
            style={{ fontFamily: '"Geist Mono", monospace' }}
            onClick={() => {
              const idx = SPEEDS.indexOf(speed);
              setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
            }}
          >
            {speed}x
          </button>

          <span className="text-[9px] tabular-nums text-[var(--text-faint)]" style={{ fontFamily: '"Geist Mono", monospace' }}>
            {currentIndex + 1}/{timeline.events.length}
          </span>
        </div>
      </div>
    </div>
  );
}
