import { useMemo } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { SessionReplayView } from "./SessionReplayView";
import { useT } from "../i18n/useT";
import { useProjectStore } from "../stores/projectStore";
import { useTerminalRuntimeStore } from "../terminal/terminalRuntimeStore";
import { panToTerminal } from "../utils/panToTerminal";
import {
  buildCanvasTerminalSections,
  type CanvasTerminalItem,
  type CanvasTerminalState,
} from "./sessionPanelModel";

const STATUS_COLORS: Record<CanvasTerminalState, string> = {
  attention: "#ef4444",
  running: "#f59e0b",
  thinking: "#22c55e",
  done: "#6b7280",
  idle: "#94a3b8",
};

function formatShortAge(iso: string | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
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

function formatTerminalActivity(
  item: CanvasTerminalItem,
  t: ReturnType<typeof useT>,
): string {
  switch (item.state) {
    case "attention":
      return t.sessions_status_attention;
    case "running": {
      const tool = item.currentTool ? summarizeToolName(item.currentTool) : "";
      return tool
        ? `${t.sessions_status_running} · ${tool}`
        : t.sessions_status_running;
    }
    case "thinking":
      return t.sessions_status_generating;
    case "done":
      return t.sessions_status_turn_complete;
    default:
      return t.sessions_status_idle;
  }
}

function TerminalCard({
  item,
  t,
  compact = false,
}: {
  item: CanvasTerminalItem;
  t: ReturnType<typeof useT>;
  compact?: boolean;
}) {
  const subtitleParts = [
    item.locationLabel && item.locationLabel !== item.title ? item.locationLabel : null,
    formatTerminalActivity(item, t),
    formatShortAge(item.activityAt),
  ].filter(Boolean);

  return (
    <button
      className={`w-full rounded-md flex items-center gap-2 text-left cursor-pointer transition-colors ${
        compact ? "px-2 py-1.5" : "px-2 py-2"
      } ${
        item.focused
          ? "bg-[var(--surface-hover)] ring-1 ring-[var(--accent)]/35"
          : "bg-[var(--surface)] hover:bg-[var(--sidebar-hover)]"
      }`}
      onClick={() => panToTerminal(item.terminalId)}
    >
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_COLORS[item.state] }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate">{item.title}</div>
        <div className="text-[10px] text-[var(--text-muted)] truncate">
          {subtitleParts.join(" · ")}
        </div>
      </div>
    </button>
  );
}

function Section({
  title,
  items,
  t,
}: {
  title: string;
  items: CanvasTerminalItem[];
  t: ReturnType<typeof useT>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="shrink-0 px-3 pt-2 pb-2">
      <div
        className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <TerminalCard key={item.terminalId} item={item} t={t} compact />
        ))}
      </div>
    </div>
  );
}

export function SessionsPanel() {
  const panelView = useSessionStore((s) => s.panelView);
  const liveSessions = useSessionStore((s) => s.liveSessions);
  const historySessions = useSessionStore((s) => s.historySessions);
  const projects = useProjectStore((s) => s.projects);
  const runtimeTerminals = useTerminalRuntimeStore((s) => s.terminals);
  const t = useT();

  const sessionsById = useMemo(() => {
    const map = new Map<string, (typeof liveSessions)[number]>();
    for (const session of [...historySessions, ...liveSessions]) {
      map.set(session.sessionId, session);
    }
    return map;
  }, [historySessions, liveSessions]);

  const telemetryByTerminalId = useMemo(() => {
    const map = new Map<string, (typeof runtimeTerminals)[string]["telemetry"]>();
    for (const [terminalId, snapshot] of Object.entries(runtimeTerminals)) {
      map.set(terminalId, snapshot.telemetry);
    }
    return map;
  }, [runtimeTerminals]);

  const sections = useMemo(
    () => buildCanvasTerminalSections(projects, telemetryByTerminalId, sessionsById),
    [projects, sessionsById, telemetryByTerminalId],
  );

  const hasAnyTerminals =
    !!sections.focused ||
    sections.attention.length > 0 ||
    sections.progress.length > 0 ||
    sections.done.length > 0 ||
    sections.idle.length > 0;

  if (panelView === "replay") {
    return <SessionReplayView />;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {sections.focused && (
        <div className="shrink-0 px-3 pt-3 pb-2">
          <div
            className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.sessions_focused}
          </div>
          <TerminalCard item={sections.focused} t={t} />
        </div>
      )}

      <Section title={t.sessions_needs_attention} items={sections.attention} t={t} />
      <Section title={t.sessions_in_progress} items={sections.progress} t={t} />
      <Section title={t.sessions_done} items={sections.done} t={t} />
      <Section title={t.sessions_background} items={sections.idle} t={t} />

      {!hasAnyTerminals && (
        <div className="flex-1 px-4 py-6 text-[11px] text-[var(--text-faint)] text-center">
          {t.sessions_no_canvas_items}
        </div>
      )}
    </div>
  );
}
