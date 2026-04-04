import { useSessionStore } from "../stores/sessionStore";
import { SessionReplayView } from "./SessionReplayView";
import { useT } from "../i18n/useT";
import type { SessionInfo } from "../../shared/sessions";
import { useProjectStore } from "../stores/projectStore";
import {
  buildSessionSections,
  collectCanvasSessionMeta,
  type CanvasSessionMeta,
} from "./sessionPanelModel";

const STATUS_COLORS: Record<SessionInfo["status"], string> = {
  generating: "#22c55e",
  tool_running: "#f59e0b",
  turn_complete: "#6b7280",
  idle: "#6b7280",
  error: "#ef4444",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatShortAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
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

function collapseWhitespace(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function summarizeToolName(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";

  const tokens = normalized.split(/\s+/);
  const primary = tokens[0]?.split("/").pop() ?? normalized;
  if (primary === "node" && tokens[1]) {
    const child = tokens[1].split("/").pop() ?? tokens[1];
    if (child === "npm" || child === "npx") return child;
    if (child.endsWith(".js")) return child.replace(/\.js$/, "");
    return child;
  }
  return primary;
}

function resolveSessionTitle(session: SessionInfo, meta?: CanvasSessionMeta): string {
  const prompt = meta?.initialPrompt ? collapseWhitespace(meta.initialPrompt, 72) : "";
  if (prompt) return prompt;

  const terminalTitle = meta?.title ? collapseWhitespace(meta.title, 56) : "";
  if (terminalTitle && !/^(terminal|shell|claude|codex|kimi|gemini|opencode|lazygit|tmux)$/i.test(terminalTitle)) {
    return terminalTitle;
  }

  if (meta?.worktreeName) return meta.worktreeName;
  return projectName(session.projectDir);
}

function formatSessionActivity(session: SessionInfo, t: ReturnType<typeof useT>): string {
  switch (session.status) {
    case "tool_running": {
      const tool = session.currentTool ? summarizeToolName(session.currentTool) : "";
      return tool ? `${t.sessions_status_running} · ${tool}` : t.sessions_status_running;
    }
    case "generating":
      return t.sessions_status_generating;
    case "error":
      return t.sessions_status_error;
    case "turn_complete":
      return t.sessions_status_done;
    default:
      return t.sessions_status_idle;
  }
}

function SessionCard({
  session,
  meta,
  t,
}: {
  session: SessionInfo;
  meta?: CanvasSessionMeta;
  t: ReturnType<typeof useT>;
}) {
  const title = resolveSessionTitle(session, meta);
  const subtitleParts = [
    meta?.worktreeName && meta.worktreeName !== title ? meta.worktreeName : null,
    formatSessionActivity(session, t),
    formatShortAge(session.lastActivityAt),
  ].filter(Boolean);

  return (
    <div
      className={`px-2 py-1.5 rounded-md flex items-center gap-2 ${
        meta?.focused ? "bg-[var(--surface-hover)] ring-1 ring-[var(--accent)]/30" : "bg-[var(--surface)]"
      }`}
    >
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_COLORS[session.status] }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate">{title}</div>
        <div className="text-[10px] text-[var(--text-muted)] truncate">
          {subtitleParts.join(" · ")}
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
  const projects = useProjectStore((s) => s.projects);
  const t = useT();
  const canvasSessionMeta = collectCanvasSessionMeta(projects);
  const sections = buildSessionSections(liveSessions, historySessions, canvasSessionMeta);
  const hasAnySessions =
    sections.onCanvas.length > 0 ||
    sections.recent.length > 0 ||
    sections.history.length > 0;

  if (panelView === "replay") {
    return <SessionReplayView />;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {sections.onCanvas.length > 0 && (
        <div className="shrink-0 px-3 pt-3 pb-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5" style={{ fontFamily: '"Geist Mono", monospace' }}>
            {t.sessions_on_canvas}
          </div>
          <div className="flex flex-col gap-1">
            {sections.onCanvas.map((session) => (
              <SessionCard
                key={session.sessionId}
                session={session}
                meta={canvasSessionMeta.get(session.sessionId)}
                t={t}
              />
            ))}
          </div>
        </div>
      )}

      {sections.recent.length > 0 && (
        <div className="shrink-0 px-3 pt-2 pb-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5" style={{ fontFamily: '"Geist Mono", monospace' }}>
            {t.sessions_recent}
          </div>
          <div className="flex flex-col gap-1">
            {sections.recent.map((session) => (
              <SessionCard key={session.sessionId} session={session} t={t} />
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <div className="px-3 pt-2 pb-1">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1" style={{ fontFamily: '"Geist Mono", monospace' }}>
            {t.sessions_history}
          </div>
        </div>
        <div className="px-1 pb-3">
          {!hasAnySessions ? (
            <div className="px-2 py-4 text-[11px] text-[var(--text-faint)] text-center">
              {t.sessions_no_sessions}
            </div>
          ) : sections.history.length === 0 ? (
            <div className="px-2 py-3 text-[10px] text-[var(--text-faint)] text-center">
              {t.sessions_no_sessions}
            </div>
          ) : (
            sections.history.map((session) => (
              <HistoryRow
                key={session.sessionId}
                session={session}
                onClick={() => loadReplay(session.filePath)}
                msgsLabel={t.sessions_msgs}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
