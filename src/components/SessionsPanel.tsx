import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { promptAndAddProjectToScene } from "../canvas/sceneCommands";
import { closeTerminalInScene } from "../actions/terminalSceneActions";
import { IconButton } from "./ui/IconButton";
import { shouldRefreshHistorySection } from "./historySectionModel";

/**
 * Descriptor returned by `search:sessions:list`. Kept local to avoid
 * exporting a shared interface just for this panel.
 */
interface HistorySessionEntry {
  sessionId: string;
  provider: "claude" | "codex";
  projectDir: string;
  filePath: string;
  firstPrompt: string;
  startedAt: string;
  lastActivityAt: string;
  estimatedMessageCount: number;
  fileSize: number;
}

// Size of each lazy-loaded batch. Initial render shows one page; we
// request the next page when the user scrolls past the 5th-from-last
// row so there's no visible loading gap during steady scrolling.
const HISTORY_PAGE_SIZE = 20;
const HISTORY_PREFETCH_TRIGGER_ROWS = 5;
const HISTORY_REFRESH_DEBOUNCE_MS = 120;

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

export function TerminalCard({
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
    <div
      role="button"
      tabIndex={0}
      className={`group w-full rounded-md flex items-center gap-2 text-left cursor-pointer transition-colors ${
        compact ? "px-2 py-1.5" : "px-2 py-2"
      } ${
        item.focused
          ? "bg-[var(--surface-hover)] ring-1 ring-[var(--accent)]/35"
          : "bg-[var(--surface)] hover:bg-[var(--sidebar-hover)]"
      }`}
      onClick={() => panToTerminal(item.terminalId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          panToTerminal(item.terminalId);
        }
      }}
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
      <IconButton
        size="sm"
        tone="danger"
        label={t.panel_close_terminal}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          closeTerminalInScene(
            item.projectId,
            item.worktreeId,
            item.terminalId,
          );
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M2 2L8 8M8 2L2 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </IconButton>
    </div>
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

/**
 * Relative-age label that matches the search palette's format so the
 * Sessions panel's history rows and Cmd+K's session rows read the
 * same.
 */
function formatHistoryAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function historyProjectName(dir: string): string {
  return dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
}

/**
 * History browse section.
 *
 * Sits below the project tree in the right-side Sessions panel. Lists
 * the past agent sessions belonging to every project currently on the
 * canvas, sorted most-recent-first. Answers the "I don't remember
 * what I'm looking for — just show me what's been happening" need
 * directly, without requiring the user to open Cmd+K and type.
 *
 * Data path: shares the mtime-keyed metadata index in the main
 * process (`search:sessions:list`) with the Cmd+K palette, so
 * opening the sidebar doesn't trigger extra JSONL reads — whichever
 * surface asks first warms the cache for both. Scope is "every
 * canvas worktree" — deliberately wider than a per-worktree filter
 * so users browsing the sidebar don't have to fiddle with scope;
 * Cmd+K keeps the scope-switcher for the targeted-search flow.
 *
 * Default expanded because "browsing" is the purpose; defaulting
 * collapsed would make the section a hidden feature most users
 * never see (same lesson as the git history section we fixed
 * earlier).
 */
export function HistorySection({
  projectDirs,
  onOpen,
  t,
}: {
  projectDirs: string[];
  onOpen: (filePath: string) => void;
  t: ReturnType<typeof useT>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [entries, setEntries] = useState<HistorySessionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const projectDirsKey = projectDirs.join("|");
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial page load whenever the canvas project set changes.
  // Only request HISTORY_PAGE_SIZE rows — the heavy JSONL parse is
  // now scoped to what's actually about to render, not the long
  // tail (mtime-sorted so the rows that appear first ARE the ones
  // most likely to matter).
  useEffect(() => {
    if (!window.termcanvas?.search?.listSessionsPage) return;
    if (projectDirs.length === 0) {
      setEntries([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void window.termcanvas.search
      .listSessionsPage(projectDirs, { limit: HISTORY_PAGE_SIZE, offset: 0 })
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setTotal(page.total);
      })
      .catch(() => {
        if (cancelled) return;
        setEntries([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectDirsKey, refreshVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!window.termcanvas?.sessions?.onHistoryChanged) return;

    const unsubscribe = window.termcanvas.sessions.onHistoryChanged((payload) => {
      if (
        !shouldRefreshHistorySection(projectDirs, payload.projectDirs)
      ) {
        return;
      }

      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        setRefreshVersion((version) => version + 1);
      }, HISTORY_REFRESH_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [projectDirsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    if (!window.termcanvas?.search?.listSessionsPage) return;
    if (loadingMore) return;
    if (entries.length >= total) return;
    setLoadingMore(true);
    void window.termcanvas.search
      .listSessionsPage(projectDirs, {
        limit: HISTORY_PAGE_SIZE,
        offset: entries.length,
      })
      .then((page) => {
        // Dedupe in case the page boundary hit an mtime shift that
        // re-exposed an already-loaded file. Keyed by sessionId.
        setEntries((prev) => {
          const seen = new Set(prev.map((e) => e.sessionId));
          const merged = [...prev];
          for (const e of page.entries) {
            if (!seen.has(e.sessionId)) merged.push(e);
          }
          return merged;
        });
        setTotal(page.total);
      })
      .catch(() => {
        // Silently swallow — the user can still click "Load more"
        // again. A banner would be more noise than it's worth for a
        // transient read failure.
      })
      .finally(() => setLoadingMore(false));
  }, [projectDirs, entries.length, loadingMore, total]);

  // Prefetch trigger: once the user scrolls such that the 5th-from-
  // last row is in view, start fetching the next page. No explicit
  // "Load more" click needed — the button below exists as a visible
  // fallback and keyboard escape hatch, not as the primary action.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (entries.length === 0) return;
    if (entries.length >= total) return;
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (record.isIntersecting) {
            loadMore();
            break;
          }
        }
      },
      { rootMargin: "64px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [expanded, entries.length, total, loadMore]);

  const hasMore = entries.length < total;
  const sentinelIndex = Math.max(0, entries.length - HISTORY_PREFETCH_TRIGGER_ROWS);

  return (
    <div className="border-t border-[var(--border)]">
      <button
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left hover:bg-[var(--sidebar-hover)]"
        onClick={() => setExpanded((v) => !v)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          style={{ color: "var(--text-muted)" }}
        >
          <path d="M3 2l4 3-4 3V2z" fill="currentColor" />
        </svg>
        <span
          className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] font-medium"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {(t.sessions_history_title as unknown as string) ?? "History"}
        </span>
        <span
          className="ml-auto text-[10px] text-[var(--text-faint)] tabular-nums"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {loading && entries.length === 0
            ? "…"
            : total > entries.length
              ? `${entries.length}/${total}`
              : entries.length}
        </span>
      </button>
      {expanded && (
        <div className="pb-2">
          {entries.length === 0 ? (
            <div
              className="px-4 py-3 text-center text-[10px] text-[var(--text-faint)]"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {loading
                ? ((t.sessions_history_loading as unknown as string) ?? "Loading…")
                : ((t.sessions_history_empty as unknown as string) ??
                    "No past sessions in this canvas yet.")}
            </div>
          ) : (
            <div className="flex flex-col">
              {entries.map((entry, idx) => (
                <div
                  key={entry.sessionId}
                  ref={idx === sentinelIndex ? sentinelRef : undefined}
                >
                  <button
                    className="group flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-[var(--sidebar-hover)]"
                    onClick={() => onOpen(entry.filePath)}
                    title={entry.firstPrompt}
                  >
                    <span
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          entry.provider === "claude" ? "#f59e0b" : "#10b981",
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-[var(--text-primary)]">
                        {entry.firstPrompt ||
                          `(session ${entry.sessionId.slice(0, 8)})`}
                      </div>
                      <div
                        className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[var(--text-faint)]"
                        style={{ fontFamily: '"Geist Mono", monospace' }}
                      >
                        <span className="truncate">
                          {historyProjectName(entry.projectDir)}
                        </span>
                        <span>·</span>
                        <span>{entry.provider}</span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {formatHistoryAge(entry.lastActivityAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              ))}
              {hasMore && (
                <button
                  className="px-3 py-2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] text-left hover:bg-[var(--sidebar-hover)] cursor-pointer disabled:cursor-default"
                  style={{ fontFamily: '"Geist Mono", monospace' }}
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore
                    ? ((t.sessions_history_loading as unknown as string) ??
                        "Loading…")
                    : ((t.sessions_history_load_more as unknown as string) ??
                        `Load more (${total - entries.length} left)`)}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionsPanel({
  stayInListMode = false,
}: {
  /**
   * When true, the component never swaps itself into replay view
   * even if `panelView === "replay"`. Used by SessionsOverlay,
   * which renders the replay in a second pane side-by-side with
   * this list and needs the list to keep rendering at all times.
   */
  stayInListMode?: boolean;
} = {}) {
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

  // List of absolute worktree paths currently on the canvas. Used as
  // the scope for the history browse section below. Recomputed only
  // when the projects store shape changes, not on every canvas tick.
  const canvasProjectDirs = useMemo(
    () => projects.flatMap((p) => p.worktrees.map((w) => w.path)),
    [projects],
  );

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

  const [addingProject, setAddingProject] = useState(false);
  const handleAddProject = useCallback(async () => {
    if (addingProject) return;
    setAddingProject(true);
    try {
      await promptAndAddProjectToScene(t);
    } finally {
      setAddingProject(false);
    }
  }, [addingProject, t]);

  if (panelView === "replay" && !stayInListMode) {
    return <SessionReplayView />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] shrink-0">
        <span
          className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] font-medium"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {t.sessions_panel_title}
        </span>
        <IconButton
          size="md"
          tone="neutral"
          label={t.shortcut_add_project}
          busy={addingProject}
          onClick={handleAddProject}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="shrink-0"
          >
            <path
              d="M6 2V10M2 6H10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </IconButton>
      </div>
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

        {/*
          Past-session browse surface. Lives below the live project
          tree so the scroll pattern is "what's live now" → "what's
          been before" — same reading order as a chat app's "threads"
          list. Shares the Cmd+K session index via the
          listSessions IPC; no extra file reads.
        */}
        <HistorySection
          projectDirs={canvasProjectDirs}
          onOpen={loadReplay}
          t={t}
        />
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
