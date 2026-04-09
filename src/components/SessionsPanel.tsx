import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { SessionReplayView } from "./SessionReplayView";
import { useT } from "../i18n/useT";
import { useProjectStore } from "../stores/projectStore";
import { useTerminalRuntimeStore } from "../terminal/terminalRuntimeStore";
import { panToTerminal } from "../utils/panToTerminal";
import {
  buildCanvasTerminalSections,
  buildProjectTree,
  type CanvasTerminalItem,
  type CanvasTerminalState,
} from "./sessionPanelModel";
import { ProjectTree } from "./ProjectTree";
import {
  buildInspectorTrace,
  pickInspectedTerminal,
  type InspectorTraceItem,
} from "./sessionInspectorModel";
import { useCompletionSeenStore } from "../stores/completionSeenStore";

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

function formatItemTime(item: CanvasTerminalItem): string {
  const isActive =
    item.state === "running" ||
    item.state === "thinking" ||
    item.state === "attention";
  if (isActive && item.turnStartedAt) {
    return formatShortAge(item.turnStartedAt);
  }
  return formatShortAge(item.activityAt);
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
    case "attention": {
      if (item.attentionReason === "awaiting_input") {
        const tool = item.currentTool
          ? summarizeToolName(item.currentTool)
          : "";
        return tool
          ? `${t.sessions_status_awaiting_input} · ${tool}`
          : t.sessions_status_awaiting_input;
      }
      return t.sessions_status_attention;
    }
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
  hideLocation = false,
  unseenDone = false,
}: {
  item: CanvasTerminalItem;
  t: ReturnType<typeof useT>;
  compact?: boolean;
  hideLocation?: boolean;
  unseenDone?: boolean;
}) {
  const subtitleParts = [
    !hideLocation && item.locationLabel && item.locationLabel !== item.title
      ? item.locationLabel
      : null,
    formatTerminalActivity(item, t),
    formatItemTime(item),
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
        style={{
          backgroundColor: unseenDone ? "#3b82f6" : STATUS_COLORS[item.state],
        }}
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

function traceToneClass(item: InspectorTraceItem): string {
  switch (item.tone) {
    case "success":
      return "text-[#22c55e]";
    case "warning":
      return "text-[#f59e0b]";
    case "danger":
      return "text-[#ef4444]";
    default:
      return "text-[var(--text-muted)]";
  }
}

function formatTraceLabel(
  item: InspectorTraceItem,
  t: ReturnType<typeof useT>,
): string {
  switch (item.kind) {
    case "session_attached":
      return t.sessions_trace_session_attached;
    case "session_attach_failed":
      return t.sessions_trace_session_attach_failed;
    case "running_tool":
      return t.sessions_trace_running_tool;
    case "using_tool":
      return t.sessions_trace_using_tool(item.toolName ?? "");
    case "thinking":
      return t.sessions_trace_thinking;
    case "responding":
      return t.sessions_trace_responding;
    case "turn_complete":
      return t.sessions_trace_turn_complete;
    case "turn_aborted":
      return t.sessions_trace_turn_aborted;
    default:
      return t.sessions_trace_process_exited(item.exitCode);
  }
}

function Inspector({
  item,
  traceItems,
  traceLoading,
  onOpenHistory,
  t,
}: {
  item: CanvasTerminalItem | null;
  traceItems: InspectorTraceItem[];
  traceLoading: boolean;
  onOpenHistory: (filePath: string) => void;
  t: ReturnType<typeof useT>;
}) {
  if (!item) return null;

  const summaryParts = [
    item.locationLabel,
    formatTerminalActivity(item, t),
    formatItemTime(item),
  ].filter(Boolean);
  const historyPath = item.sessionFilePath;

  return (
    <div className="shrink-0 border-t border-[var(--border)] bg-[var(--sidebar)]">
      <div className="px-3 py-2 border-b border-[var(--border)]">
        <div
          className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {t.sessions_inspector}
        </div>
        <div className="mt-1 text-[11px] font-medium truncate">
          {item.title}
        </div>
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)] truncate">
          {summaryParts.join(" · ")}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            className="px-2 py-1 text-[9px] rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer"
            onClick={() => panToTerminal(item.terminalId)}
          >
            {t.sessions_jump_to_terminal}
          </button>
          {historyPath && (
            <button
              className="px-2 py-1 text-[9px] rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer"
              onClick={() => onOpenHistory(historyPath)}
            >
              {t.sessions_open_history}
            </button>
          )}
        </div>
      </div>

      <div className="px-3 py-2 max-h-[220px] overflow-y-auto">
        <div
          className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {t.sessions_recent_trace}
        </div>
        {traceLoading ? (
          <div className="text-[10px] text-[var(--text-faint)]">
            {t.sessions_trace_loading}
          </div>
        ) : traceItems.length === 0 ? (
          <div className="text-[10px] text-[var(--text-faint)]">
            {t.sessions_trace_empty}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {traceItems.map((traceItem) => (
              <div
                key={traceItem.id}
                className="flex items-start gap-2 rounded bg-[var(--surface)] px-2 py-1.5"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${traceToneClass(
                    traceItem,
                  )}`}
                  style={{
                    backgroundColor: "currentColor",
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] truncate">
                    {formatTraceLabel(traceItem, t)}
                  </div>
                  <div className="text-[9px] text-[var(--text-faint)] tabular-nums">
                    {formatShortAge(traceItem.at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SessionsPanel() {
  const panelView = useSessionStore((s) => s.panelView);
  const liveSessions = useSessionStore((s) => s.liveSessions);
  const historySessions = useSessionStore((s) => s.historySessions);
  const loadReplay = useSessionStore((s) => s.loadReplay);
  const projects = useProjectStore((s) => s.projects);
  const runtimeTerminals = useTerminalRuntimeStore((s) => s.terminals);
  const seenTerminalIds = useCompletionSeenStore((s) => s.seenTerminalIds);
  const markCompletionSeen = useCompletionSeenStore((s) => s.markSeen);
  const t = useT();
  const [traceItems, setTraceItems] = useState<InspectorTraceItem[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);

  const sessionsById = useMemo(() => {
    const map = new Map<string, (typeof liveSessions)[number]>();
    for (const session of [...historySessions, ...liveSessions]) {
      map.set(session.sessionId, session);
    }
    return map;
  }, [historySessions, liveSessions]);

  const telemetryByTerminalId = useMemo(() => {
    const map = new Map<
      string,
      (typeof runtimeTerminals)[string]["telemetry"]
    >();
    for (const [terminalId, snapshot] of Object.entries(runtimeTerminals)) {
      map.set(terminalId, snapshot.telemetry);
    }
    return map;
  }, [runtimeTerminals]);

  const sections = useMemo(
    () =>
      buildCanvasTerminalSections(
        projects,
        telemetryByTerminalId,
        sessionsById,
      ),
    [projects, sessionsById, telemetryByTerminalId],
  );
  const projectTree = useMemo(
    () =>
      buildProjectTree(
        projects,
        telemetryByTerminalId,
        sessionsById,
        seenTerminalIds,
      ),
    [projects, telemetryByTerminalId, sessionsById, seenTerminalIds],
  );
  const inspectedItem = useMemo(
    () => pickInspectedTerminal(sections),
    [sections],
  );

  const hasAnyTerminals = projectTree.length > 0;

  useEffect(() => {
    if (sections.focused?.state === "done") {
      markCompletionSeen(sections.focused.terminalId);
    }
  }, [markCompletionSeen, sections.focused]);

  useEffect(() => {
    if (
      panelView === "replay" ||
      !inspectedItem ||
      !window.termcanvas?.telemetry
    ) {
      setTraceItems([]);
      setTraceLoading(false);
      return;
    }

    let cancelled = false;
    setTraceLoading(true);

    void window.termcanvas.telemetry
      .listEvents({ terminalId: inspectedItem.terminalId, limit: 24 })
      .then((page) => {
        if (cancelled) return;
        setTraceItems(buildInspectorTrace(page.events));
        setTraceLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTraceItems([]);
        setTraceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [inspectedItem?.activityAt, inspectedItem?.terminalId, panelView]);

  if (panelView === "replay") {
    return <SessionReplayView />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ProjectTree
          projects={projectTree}
          renderTerminal={(item) => (
            <TerminalCard
              key={item.terminalId}
              item={item}
              t={t}
              compact
              hideLocation
              unseenDone={
                item.state === "done" && !seenTerminalIds.has(item.terminalId)
              }
            />
          )}
        />

        {!hasAnyTerminals && (
          <div className="flex-1 px-4 py-6 text-[11px] text-[var(--text-faint)] text-center">
            {t.sessions_no_canvas_items}
          </div>
        )}
      </div>

      {inspectedItem && (
        <Inspector
          item={inspectedItem}
          traceItems={traceItems}
          traceLoading={traceLoading}
          onOpenHistory={loadReplay}
          t={t}
        />
      )}
    </div>
  );
}
