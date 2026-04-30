import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
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
  type StashedTerminalItem,
} from "./sessionPanelModel";
import { ProjectTree } from "./ProjectTree";
import {
  buildInspectorTrace,
  pickInspectedTerminal,
  type InspectorTraceItem,
} from "./sessionInspectorModel";
import { useCompletionSeenStore } from "../stores/completionSeenStore";
import { promptAndAddProjectToScene } from "../canvas/sceneCommands";
import {
  closeTerminalInScene,
  stashTerminalInScene,
  unstashTerminalInScene,
  destroyStashedTerminalInScene,
} from "../actions/terminalSceneActions";
import { IconButton } from "./ui/IconButton";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  groupHistoryByProject,
  shouldRefreshHistorySection,
} from "./historySectionModel";

/**
 * Descriptor returned by `search:sessions:list`. Kept local to avoid
 * exporting a shared interface just for this panel.
 */
interface HistorySessionEntry {
  sessionId: string;
  provider: "claude" | "codex" | "kimi";
  projectDir: string;
  filePath: string;
  firstPrompt: string;
  startedAt: string;
  lastActivityAt: string;
  estimatedMessageCount: number;
  fileSize: number;
}

// Load enough entries upfront to cover most real-world canvases without
// a second fetch. Users who want more per-project can expand inline.
const HISTORY_PAGE_SIZE = 100;
// Each project group shows this many sessions by default.
const HISTORY_GROUP_DEFAULT_LIMIT = 7;
const HISTORY_REFRESH_DEBOUNCE_MS = 120;

// Three signal levels:
//   red  = needs your attention (real error / explicit awaiting input)
//   green = working, no need to look
//   gray = nothing to convey (done & viewed, or never started)
// `unseenDone` is layered on top at render time using --accent.
const STATUS_COLORS: Record<CanvasTerminalState, string> = {
  attention: "var(--red)",
  active: "var(--green)",
  done: "var(--text-muted)",
  idle: "var(--text-muted)",
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
  const isActive = item.state === "active" || item.state === "attention";
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
    case "active": {
      const tool = item.currentTool ? summarizeToolName(item.currentTool) : "";
      return tool
        ? `${t.sessions_status_active} · ${tool}`
        : t.sessions_status_active;
    }
    case "done":
      return t.sessions_status_turn_complete;
    default:
      return t.sessions_status_idle;
  }
}

export function TerminalCard({
  item,
  t,
  hideLocation = false,
  unseenDone = false,
}: {
  item: CanvasTerminalItem;
  t: ReturnType<typeof useT>;
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
      className={`tc-row-icon group w-full rounded-md flex items-center gap-2 text-left cursor-pointer min-h-[44px] px-2 py-1.5 ${
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
          backgroundColor: unseenDone
            ? "var(--accent)"
            : STATUS_COLORS[item.state],
        }}
      />
      <div className="flex-1 min-w-0">
        <div
          className="truncate"
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-regular)",
            color: "var(--text-primary)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          {item.title}
        </div>
        <div
          className="tc-caption truncate"
          style={{ color: "var(--text-muted)" }}
        >
          {subtitleParts.join(" · ")}
        </div>
      </div>
      <IconButton
        size="sm"
        tone="neutral"
        label={t.stash_terminal}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          stashTerminalInScene(
            item.projectId,
            item.worktreeId,
            item.terminalId,
          );
        }}
      >
        {/* archive: arrow down into tray */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M5 1v5M5 6L3 4M5 6l2-2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M1 6h2v2a1 1 0 001 1h2a1 1 0 001-1V6h2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </IconButton>
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
      return "text-[var(--green)]";
    case "warning":
      return "text-[var(--amber)]";
    case "danger":
      return "text-[var(--red)]";
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
      <div className="tc-row-divider px-3 py-2">
        <div className="tc-eyebrow tc-mono">{t.sessions_inspector}</div>
        <div
          className="mt-1.5 truncate"
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            color: "var(--text-primary)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          {item.title}
        </div>
        <div
          className="tc-caption mt-0.5 truncate"
          style={{ color: "var(--text-muted)" }}
        >
          {summaryParts.join(" · ")}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            className="tc-row-icon tc-caption px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer"
            onClick={() => panToTerminal(item.terminalId)}
          >
            {t.sessions_jump_to_terminal}
          </button>
          {historyPath && (
            <button
              className="tc-row-icon tc-caption px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer"
              onClick={() => onOpenHistory(historyPath)}
            >
              {t.sessions_open_history}
            </button>
          )}
        </div>
      </div>

      <div className="px-3 py-2 max-h-[220px] overflow-y-auto">
        <div className="tc-eyebrow tc-mono mb-2">{t.sessions_recent_trace}</div>
        {traceLoading ? (
          <div className="tc-caption" role="status" aria-live="polite">
            {t.sessions_trace_loading}
          </div>
        ) : traceItems.length === 0 ? (
          <div className="tc-caption">{t.sessions_trace_empty}</div>
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
                  <div
                    className="tc-caption truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {formatTraceLabel(traceItem, t)}
                  </div>
                  <div className="tc-timestamp" style={{ fontSize: "9px" }}>
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

function StashedCard({
  item,
  t,
}: {
  item: StashedTerminalItem;
  t: ReturnType<typeof useT>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="tc-row-icon group min-h-[44px] flex items-center gap-2 rounded-md px-2 py-1.5 bg-[var(--surface)] hover:bg-[var(--sidebar-hover)]">
      <div className="flex-1 min-w-0">
        <div
          className="truncate"
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-regular)",
            color: "var(--text-secondary)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          {item.title}
        </div>
        <div className="tc-caption truncate">{item.originLabel}</div>
      </div>
      <IconButton
        size="sm"
        tone="neutral"
        label={t.stash_restore}
        onClick={() => unstashTerminalInScene(item.terminalId)}
      >
        {/* unarchive: arrow up out of tray */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M5 6V1M5 1L3 3M5 1l2 2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M1 6h2v2a1 1 0 001 1h2a1 1 0 001-1V6h2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </IconButton>
      <IconButton
        size="sm"
        tone="danger"
        label={t.stash_destroy}
        onClick={() => setConfirmOpen(true)}
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
      <ConfirmDialog
        open={confirmOpen}
        title={t.stash_destroy}
        body={item.title}
        confirmLabel={t.stash_destroy}
        confirmTone="danger"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          destroyStashedTerminalInScene(item.terminalId);
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}

export function StashedSection({
  items,
  t,
}: {
  items: StashedTerminalItem[];
  t: ReturnType<typeof useT>;
}) {
  const [expanded, setExpanded] = useState(items.length > 0);
  const prevCount = useRef(items.length);

  useEffect(() => {
    if (prevCount.current === 0 && items.length > 0) {
      setExpanded(true);
    }
    prevCount.current = items.length;
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="border-t border-[var(--border)]"
    >
      <CollapsibleTrigger className="tc-row-hover mx-2 flex min-h-[30px] items-center gap-1.5 rounded-md px-3 py-0 text-left">
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={`shrink-0 ${expanded ? "rotate-90" : ""}`}
          style={{
            color: "var(--text-muted)",
            transition: "transform var(--duration-quick) var(--ease-out-soft)",
          }}
        >
          <path d="M3 2l4 3-4 3V2z" fill="currentColor" />
        </svg>
        <span className="tc-eyebrow tc-mono">{t.stash_box}</span>
        <span
          className="tc-eyebrow tc-mono ml-auto tabular-nums"
          style={{ color: "var(--text-faint)" }}
        >
          {items.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pb-2 flex flex-col gap-0.5 px-2">
          {items.map((item) => (
            <StashedCard key={item.terminalId} item={item} t={t} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
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

const HIDDEN_HISTORY_STORAGE_KEY = "termcanvas:history:hidden:v1";

function loadHiddenSessions(): Set<string> {
  if (typeof window === "undefined" || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_HISTORY_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function persistHiddenSessions(hidden: Set<string>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      HIDDEN_HISTORY_STORAGE_KEY,
      JSON.stringify(Array.from(hidden)),
    );
  } catch {}
}

const PINNED_HISTORY_STORAGE_KEY = "termcanvas:history:pinned:v1";

function loadPinnedSessions(): Set<string> {
  if (typeof window === "undefined" || !window.localStorage) return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_HISTORY_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function persistPinnedSessions(pinned: Set<string>): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      PINNED_HISTORY_STORAGE_KEY,
      JSON.stringify(Array.from(pinned)),
    );
  } catch {}
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
 * Visual structure: rows are grouped by project (project header →
 * sessions sorted newest-first within the group). The flat global
 * chronological list interleaved sessions from different projects on
 * the canvas, which made it hard to triangulate "the conversation I
 * had about <project>" — grouping fixes that without changing the
 * underlying IPC.
 *
 * Provider (claude/codex/kimi) is no longer surfaced as a row badge.
 * It's not actionable from the list (the row opens the same replay
 * regardless), so it was metadata noise; the replay header still
 * shows it for context, and the row title attribute carries it for
 * accessibility / power users.
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
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(() => loadHiddenSessions());
  const [pinned, setPinned] = useState<Set<string>>(() => loadPinnedSessions());
  // Groups folded via the chevron header click.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  // Per-group display limit. Absent = HISTORY_GROUP_DEFAULT_LIMIT. Each
  // "show more" click increments by HISTORY_GROUP_DEFAULT_LIMIT.
  const [groupLimits, setGroupLimits] = useState<Map<string, number>>(
    new Map(),
  );
  // Groups currently fetching more sessions from the server.
  const [loadingGroups, setLoadingGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((projectDir: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(projectDir)) next.delete(projectDir);
      else next.add(projectDir);
      return next;
    });
  }, []);

  const hideSession = useCallback((sessionId: string) => {
    setHidden((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.add(sessionId);
      persistHiddenSessions(next);
      return next;
    });
  }, []);

  const showMoreInGroup = useCallback(
    (projectDir: string, currentLimit: number, loadedCount: number) => {
      const nextLimit = currentLimit + HISTORY_GROUP_DEFAULT_LIMIT;
      // If the next page would exceed what's loaded, fetch more from the server first.
      if (
        nextLimit > loadedCount &&
        window.termcanvas?.search?.listSessionsPage
      ) {
        setLoadingGroups((prev) => new Set(prev).add(projectDir));
        void window.termcanvas.search
          .listSessionsPage([projectDir], { limit: nextLimit, offset: 0 })
          .then((page) => {
            setEntries((prev) => {
              const seen = new Set(prev.map((e) => e.sessionId));
              const merged = [...prev];
              for (const e of page.entries) {
                if (!seen.has(e.sessionId)) merged.push(e);
              }
              return merged;
            });
          })
          .finally(() => {
            setLoadingGroups((prev) => {
              const next = new Set(prev);
              next.delete(projectDir);
              return next;
            });
            setGroupLimits((prev) => new Map(prev).set(projectDir, nextLimit));
          });
      } else {
        setGroupLimits((prev) => new Map(prev).set(projectDir, nextLimit));
      }
    },
    [],
  );

  const pinSession = useCallback((sessionId: string) => {
    setPinned((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.add(sessionId);
      persistPinnedSessions(next);
      return next;
    });
  }, []);

  const unpinSession = useCallback((sessionId: string) => {
    setPinned((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      persistPinnedSessions(next);
      return next;
    });
  }, []);

  const projectDirsKey = projectDirs.join("|");
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const unsubscribe = window.termcanvas.sessions.onHistoryChanged(
      (payload) => {
        if (!shouldRefreshHistorySection(projectDirs, payload.projectDirs))
          return;
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          refreshTimerRef.current = null;
          setRefreshVersion((v) => v + 1);
        }, HISTORY_REFRESH_DEBOUNCE_MS);
      },
    );
    return () => {
      unsubscribe();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [projectDirsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleEntries = useMemo(
    () => entries.filter((e) => !hidden.has(e.sessionId)),
    [entries, hidden],
  );

  const pinnedEntries = useMemo(
    () =>
      visibleEntries
        .filter((e) => pinned.has(e.sessionId))
        .sort(
          (a, b) =>
            new Date(b.lastActivityAt).getTime() -
            new Date(a.lastActivityAt).getTime(),
        ),
    [visibleEntries, pinned],
  );

  const unpinnedEntries = useMemo(
    () => visibleEntries.filter((e) => !pinned.has(e.sessionId)),
    [visibleEntries, pinned],
  );

  const groups = useMemo(
    () => groupHistoryByProject(unpinnedEntries),
    [unpinnedEntries],
  );

  const countLabel =
    loading && entries.length === 0 ? "…" : `${entries.length}`;

  return (
    <div className="border-t border-[var(--border)]">
      <button
        type="button"
        className="tc-row-hover mx-2 flex min-h-[30px] items-center gap-1.5 rounded-md px-3 py-0 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={`shrink-0 ${expanded ? "rotate-90" : ""}`}
          style={{
            color: "var(--text-muted)",
            transition:
              "transform var(--duration-quick) var(--ease-out-soft)",
          }}
        >
          <path d="M3 2l4 3-4 3V2z" fill="currentColor" />
        </svg>
        <span className="tc-eyebrow tc-mono">
          {(t.sessions_history_title as unknown as string) ?? "History"}
        </span>
        <span className="ml-auto tc-eyebrow tc-mono tabular-nums">
          {countLabel}
        </span>
      </button>
      {expanded && (
        <div className="pb-2">
          {entries.length === 0 ? (
            <div
              className="tc-label px-4 py-3 text-center"
              role="status"
              aria-live="polite"
            >
              {loading
                ? ((t.sessions_history_loading as unknown as string) ??
                  "Loading…")
                : ((t.sessions_history_empty as unknown as string) ??
                  "No past sessions in this canvas yet.")}
            </div>
          ) : (
            <div className="flex flex-col">
              {pinnedEntries.length > 0 && (
                <div className="mb-0.5">
                  <div className="mx-2 flex min-h-[30px] items-center gap-1.5 rounded-md px-3 py-0">
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 10 10"
                      fill="none"
                      className="shrink-0"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <circle cx="6" cy="4" r="2.2" fill="currentColor" />
                      <line
                        x1="4.4"
                        y1="5.6"
                        x2="2"
                        y2="8"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span
                      className="truncate"
                      style={{
                        fontSize: "var(--text-base)",
                        fontWeight: "var(--weight-regular)",
                        color: "var(--text-primary)",
                        lineHeight: "var(--leading-snug)",
                      }}
                    >
                      Pinned
                    </span>
                    <span
                      className="tc-caption ml-auto tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {pinnedEntries.length}
                    </span>
                  </div>
                  {pinnedEntries.map((entry) => (
                    <HistoryRow
                      key={entry.sessionId}
                      entry={entry}
                      isPinned={true}
                      onOpen={onOpen}
                      onHide={hideSession}
                      onPin={pinSession}
                      onUnpin={unpinSession}
                    />
                  ))}
                </div>
              )}
              {groups.map((group) => {
                const isCollapsed = collapsedGroups.has(group.projectDir);
                const limit =
                  groupLimits.get(group.projectDir) ??
                  HISTORY_GROUP_DEFAULT_LIMIT;
                const displayEntries = group.entries.slice(0, limit);
                const hiddenCount =
                  group.entries.length - displayEntries.length;
                return (
                  <div key={group.projectDir} className="mb-0.5 last:mb-0">
                    <button
                      type="button"
                      className="tc-row-hover group/grp mx-2 flex min-h-[30px] items-center gap-1.5 rounded-md px-3 py-0 text-left cursor-pointer"
                      onClick={() => toggleGroup(group.projectDir)}
                      title={group.projectDir}
                    >
                      <span className="shrink-0 flex items-center justify-center text-[var(--text-muted)]">
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          className="shrink-0"
                          style={{
                            transform: isCollapsed
                              ? "rotate(0deg)"
                              : "rotate(90deg)",
                            transition:
                              "transform var(--duration-quick) var(--ease-out-soft)",
                          }}
                        >
                          <path d="M3 2l4 3-4 3z" fill="currentColor" />
                        </svg>
                      </span>
                      <span
                        className="truncate flex-1 min-w-0"
                        style={{
                          fontSize: "var(--text-base)",
                          fontWeight: "var(--weight-regular)",
                          color: "var(--text-primary)",
                          lineHeight: "var(--leading-snug)",
                        }}
                      >
                        {historyProjectName(group.projectDir)}
                      </span>
                      <span
                        className="tc-caption tabular-nums"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {group.entries.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <>
                        {displayEntries.map((entry) => (
                          <HistoryRow
                            key={entry.sessionId}
                            entry={entry}
                            isPinned={pinned.has(entry.sessionId)}
                            onOpen={onOpen}
                            onHide={hideSession}
                            onPin={pinSession}
                            onUnpin={unpinSession}
                          />
                        ))}
                        {hiddenCount > 0 && (
                          <button
                            type="button"
                            className="tc-row-icon mx-2 flex min-h-[30px] items-center gap-1 rounded-md pl-6 pr-3 py-0 text-left tc-timestamp hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] disabled:opacity-50 disabled:cursor-default"
                            disabled={loadingGroups.has(group.projectDir)}
                            onClick={(e) => {
                              e.stopPropagation();
                              showMoreInGroup(
                                group.projectDir,
                                limit,
                                group.entries.length,
                              );
                            }}
                          >
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 10 10"
                              fill="none"
                              className="shrink-0"
                            >
                              <path
                                d="M5 2v6M2 5h6"
                                stroke="currentColor"
                                strokeWidth="1.3"
                                strokeLinecap="round"
                              />
                            </svg>
                            {loadingGroups.has(group.projectDir)
                              ? "Loading…"
                              : `${hiddenCount} more`}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  entry,
  isPinned,
  onOpen,
  onHide,
  onPin,
  onUnpin,
}: {
  entry: HistorySessionEntry;
  isPinned: boolean;
  onOpen: (filePath: string) => void;
  onHide: (sessionId: string) => void;
  onPin: (sessionId: string) => void;
  onUnpin: (sessionId: string) => void;
}) {
  const [pendingHide, setPendingHide] = useState(false);

  useEffect(() => {
    if (!pendingHide) return;
    const timer = setTimeout(() => setPendingHide(false), 3000);
    return () => clearTimeout(timer);
  }, [pendingHide]);

  return (
    <div
      role="button"
      tabIndex={0}
      className="tc-row-hover group mx-2 flex min-h-[44px] items-center gap-1.5 rounded-md pl-4 pr-2 py-1.5 text-left cursor-pointer"
      onClick={() => onOpen(entry.filePath)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(entry.filePath);
        }
      }}
      title={`${entry.firstPrompt}\n${entry.provider}`}
    >
      {/* Left pin slot — fixed width so content never shifts */}
      <span
        className={
          "shrink-0 flex items-center justify-center w-4 transition-opacity " +
          (isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100")
        }
      >
        <IconButton
          size="sm"
          tone="neutral"
          label={isPinned ? "Unpin from top" : "Pin to top"}
          className={isPinned ? "!text-[var(--accent)]" : ""}
          onClick={(e) => {
            e.stopPropagation();
            if (isPinned) onUnpin(entry.sessionId);
            else onPin(entry.sessionId);
          }}
        >
          {isPinned ? (
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
              <circle cx="7" cy="4.5" r="2.5" fill="currentColor" />
              <line
                x1="5.2"
                y1="6.3"
                x2="2.5"
                y2="9"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
              <circle
                cx="7"
                cy="4.5"
                r="2.5"
                stroke="currentColor"
                strokeWidth="1.1"
              />
              <line
                x1="5.2"
                y1="6.3"
                x2="2.5"
                y2="9"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          )}
        </IconButton>
      </span>

      <div className="min-w-0 flex-1">
        <div
          className="truncate"
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-regular)",
            color: "var(--text-primary)",
            lineHeight: "var(--leading-snug)",
          }}
        >
          {entry.firstPrompt || `(session ${entry.sessionId.slice(0, 8)})`}
        </div>
        <div className="mt-0.5 tc-timestamp">
          {formatHistoryAge(entry.lastActivityAt)}
        </div>
      </div>

      {/* Two-step hide: first click arms (red), second executes permanently */}
      <span
        className={
          "shrink-0 transition-opacity " +
          (pendingHide ? "opacity-100" : "opacity-0 group-hover:opacity-100")
        }
      >
        <IconButton
          size="sm"
          tone={pendingHide ? "danger" : "neutral"}
          label={
            pendingHide
              ? "Click again to hide permanently"
              : "Hide from history"
          }
          className={pendingHide ? "bg-[var(--red-soft)]" : ""}
          onClick={(e) => {
            e.stopPropagation();
            if (pendingHide) {
              onHide(entry.sessionId);
            } else {
              setPendingHide(true);
            }
          }}
          onBlur={() => setPendingHide(false)}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M1 6c1.2-2.3 3-3.5 5-3.5s3.8 1.2 5 3.5c-1.2 2.3-3 3.5-5 3.5S2.2 8.3 1 6z"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <path
              d="M2 10L10 2"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </svg>
        </IconButton>
      </span>
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
  const projectTreeResult = useMemo(
    () =>
      buildProjectTree(
        projects,
        telemetryByTerminalId,
        sessionsById,
        seenTerminalIds,
      ),
    [projects, telemetryByTerminalId, sessionsById, seenTerminalIds],
  );
  const projectTree = projectTreeResult.projects;
  const stashedItems = projectTreeResult.stashed;
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

  const renderTerminal = useCallback(
    (item: CanvasTerminalItem) => (
      <TerminalCard
        key={item.terminalId}
        item={item}
        t={t}
        hideLocation
        unseenDone={
          item.state === "done" && !seenTerminalIds.has(item.terminalId)
        }
      />
    ),
    [t, seenTerminalIds],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="tc-row-divider flex items-center justify-between px-3 py-2 shrink-0">
        <span className="tc-eyebrow tc-mono">{t.sessions_panel_title}</span>
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
      <div className="tc-sidebar-tree-font flex-1 min-h-0 overflow-y-auto">
        <ProjectTree projects={projectTree} renderTerminal={renderTerminal} />

        {!hasAnyTerminals && (
          <div className="tc-label flex-1 px-4 py-6 text-center">
            {t.sessions_no_canvas_items}
          </div>
        )}

        <StashedSection items={stashedItems} t={t} />

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
