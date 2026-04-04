import { useSessionStore } from "../stores/sessionStore";
import { SessionReplayView } from "./SessionReplayView";
import { useT } from "../i18n/useT";
import type { SessionInfo } from "../../shared/sessions";

const STATUS_COLORS: Record<SessionInfo["status"], string> = {
  generating: "#22c55e",
  tool_running: "#f59e0b",
  turn_complete: "#6b7280",
  idle: "#6b7280",
  error: "#ef4444",
};

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function projectName(dir: string): string {
  const normalized = dir.replace(/\\/g, "/");
  if (normalized.includes("/")) {
    const parts = normalized.split("/").filter(Boolean);
    return parts[parts.length - 1] || dir;
  }
  const parts = dir.replace(/^-/, "").split("-");
  return parts[parts.length - 1] || dir;
}

function SessionCard({ session, managedLabel }: { session: SessionInfo; managedLabel: string }) {
  return (
    <div className="px-2 py-1.5 rounded-md bg-[var(--surface)] flex items-center gap-2">
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_COLORS[session.status] }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate">{projectName(session.projectDir)}</div>
        <div className="text-[10px] text-[var(--text-muted)] truncate">
          {session.currentTool ? `${session.currentTool}` : session.status}
          {" · "}
          {formatDuration(session.startedAt)}
          {session.isManaged && ` · ${managedLabel}`}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ session, onClick, msgsLabel }: { session: SessionInfo; onClick: () => void; msgsLabel: string }) {
  return (
    <button
      className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-[var(--sidebar-hover)] rounded cursor-pointer text-left"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[11px] truncate">{projectName(session.projectDir)}</div>
        <div className="text-[10px] text-[var(--text-muted)]">
          {formatTime(session.lastActivityAt)}
          {" · "}
          {session.messageCount} {msgsLabel}
          {session.tokenTotal > 0 && ` · ${Math.round(session.tokenTotal / 1000)}k tok`}
        </div>
      </div>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-[var(--text-faint)]">
        <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function SessionsPanel() {
  const panelView = useSessionStore((s) => s.panelView);
  const liveSessions = useSessionStore((s) => s.liveSessions);
  const historySessions = useSessionStore((s) => s.historySessions);
  const loadReplay = useSessionStore((s) => s.loadReplay);
  const t = useT();

  if (panelView === "replay") {
    return <SessionReplayView />;
  }

  return (
    <div className="flex flex-col h-full">
      {liveSessions.length > 0 && (
        <div className="shrink-0 px-3 pt-3 pb-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5" style={{ fontFamily: '"Geist Mono", monospace' }}>
            {t.sessions_live}
          </div>
          <div className="flex flex-col gap-1">
            {liveSessions.map((s) => (
              <SessionCard key={s.sessionId} session={s} managedLabel={t.sessions_managed} />
            ))}
          </div>
        </div>
      )}

      {liveSessions.length > 0 && historySessions.length > 0 && (
        <div className="mx-3 h-px bg-[var(--border)]" />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 pt-2 pb-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1" style={{ fontFamily: '"Geist Mono", monospace' }}>
            {t.sessions_history}
          </div>
        </div>
        <div className="px-1 pb-3">
          {historySessions.length === 0 ? (
            <div className="px-2 py-4 text-[11px] text-[var(--text-faint)] text-center">
              {t.sessions_no_sessions}
            </div>
          ) : (
            historySessions.map((s) => (
              <HistoryRow
                key={s.sessionId}
                session={s}
                onClick={() => loadReplay(s.filePath)}
                msgsLabel={t.sessions_msgs}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
