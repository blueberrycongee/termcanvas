import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useHubStore } from "../stores/hubStore";
import { useProjectStore } from "../stores/projectStore";
import { usePinStore } from "../stores/pinStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import {
  formatShortcut,
  useShortcutStore,
  type ShortcutMap,
} from "../stores/shortcutStore";
import { useStatusDigestStore } from "../stores/statusDigestStore";
import { useCommandPaletteStore } from "../stores/commandPaletteStore";
import { useTerminalRuntimeStateStore } from "../stores/terminalRuntimeStateStore";
import { useT } from "../i18n/useT";
import {
  ACTIVITY_WINDOW_MS,
  getActivityBuckets,
  getRecentActivity,
  subscribeBucketUpdates,
} from "../terminal/terminalActivityTracker";
import {
  WAYPOINT_SLOTS,
  getActiveWaypointProjectId,
  recallWaypointFromActiveProject,
} from "../actions/spatialWaypointActions";
import { panToTerminal } from "../utils/panToTerminal";
import type {
  ProjectData,
  TerminalData,
  TerminalStatus,
  TerminalType,
  SpatialWaypointSlot,
} from "../types";

// Anchored side-drawer chrome. Width chosen to fit a row of:
// glyph + label + project meta + sparkline + timestamp without truncating
// at typical project naming density. Narrower than the right panel's
// expanded width on purpose — the Hub overlays the panel rather than
// sharing the column, so a slimmer drawer leaves more canvas visible
// past the curtain.
export const HUB_WIDTH = 340;
const TOOLBAR_INSET = 44;

const RUNNING_STATUSES = new Set<TerminalStatus>([
  "running",
  "active",
  "waiting",
]);

const ACTIVITY_FEED_LIMIT = 10;

interface ResolvedTerminalSlot {
  terminal: TerminalData;
  resolvedStatus: TerminalStatus;
  projectId: string;
  projectName: string;
  worktreeName: string;
}

interface SummaryCounts {
  total: number;
  running: number;
  lastActivityAt: number | null;
}

function formatRelativeTime(
  t: ReturnType<typeof useT>,
  now: number,
  ts: number,
): string {
  const elapsed = Math.max(0, now - ts);
  if (elapsed < 5_000) return t["hub.time.justNow"];
  const seconds = Math.round(elapsed / 1000);
  if (seconds < 60) return t["hub.time.secondsAgo"](seconds);
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t["hub.time.minutesAgo"](minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t["hub.time.hoursAgo"](hours);
  const days = Math.round(hours / 24);
  return t["hub.time.daysAgo"](days);
}

function buildResolvedTerminalIndex(
  projects: ProjectData[],
  runtimeMap: ReturnType<
    typeof useTerminalRuntimeStateStore.getState
  >["terminals"],
): Map<string, ResolvedTerminalSlot> {
  const index = new Map<string, ResolvedTerminalSlot>();
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const terminal of worktree.terminals) {
        const runtime = runtimeMap[terminal.id];
        const resolvedStatus = runtime?.status ?? terminal.status;
        index.set(terminal.id, {
          terminal,
          resolvedStatus,
          projectId: project.id,
          projectName: project.name,
          worktreeName: worktree.name,
        });
      }
    }
  }
  return index;
}

function summarizeTerminals(
  index: Map<string, ResolvedTerminalSlot>,
  recentLastActivity: number | null,
): SummaryCounts {
  let total = 0;
  let running = 0;
  for (const slot of index.values()) {
    if (slot.terminal.stashed) continue;
    total += 1;
    if (RUNNING_STATUSES.has(slot.resolvedStatus)) {
      running += 1;
    }
  }
  return {
    total,
    running,
    lastActivityAt: recentLastActivity,
  };
}

interface StatusTone {
  labelKey:
    | "hub.status.running"
    | "hub.status.active"
    | "hub.status.waiting"
    | "hub.status.completed"
    | "hub.status.success"
    | "hub.status.error"
    | "hub.status.idle";
  color: string;
  pulse: boolean;
}

const STATUS_TONE: Record<TerminalStatus, StatusTone> = {
  running: { labelKey: "hub.status.running", color: "var(--accent)", pulse: true },
  active: { labelKey: "hub.status.active", color: "var(--accent)", pulse: true },
  waiting: { labelKey: "hub.status.waiting", color: "var(--amber)", pulse: false },
  completed: { labelKey: "hub.status.completed", color: "var(--cyan)", pulse: false },
  success: { labelKey: "hub.status.success", color: "var(--green)", pulse: false },
  error: { labelKey: "hub.status.error", color: "var(--red)", pulse: false },
  idle: { labelKey: "hub.status.idle", color: "var(--text-muted)", pulse: false },
};

const TYPE_GLYPH_LETTER: Record<TerminalType, string> = {
  shell: ">_",
  claude: "C",
  codex: "X",
  kimi: "K",
  gemini: "G",
  opencode: "O",
  wuu: "W",
  lazygit: "g",
  tmux: "T",
};

interface SparklineProps {
  buckets: ReadonlyArray<number>;
}

function Sparkline({ buckets }: SparklineProps) {
  // 10 buckets × 30s each = 5 min window. Bars are normalised against the
  // local max so quiet terminals still show shape rather than being
  // flattened by a noisy peer's scale.
  const max = Math.max(1, ...buckets);
  const barWidth = 4;
  const gap = 2;
  const height = 14;
  const width = buckets.length * (barWidth + gap) - gap;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{ flexShrink: 0, color: "var(--text-muted)" }}
    >
      {/* Bucket array is newest-first; reverse so the oldest column sits
          on the left and the eye reads left → right as time forward. */}
      {[...buckets].reverse().map((value, i) => {
        const h = Math.max(1, Math.round((value / max) * height));
        const x = i * (barWidth + gap);
        return (
          <rect
            key={i}
            x={x}
            y={height - h}
            width={barWidth}
            height={h}
            rx={1}
            fill="currentColor"
            opacity={value === 0 ? 0.18 : 0.5 + (value / max) * 0.45}
          />
        );
      })}
    </svg>
  );
}

interface CapabilityHint {
  id: string;
  label: string;
  shortcutKey?: keyof ShortcutMap;
  shortcutLiteral?: string;
  perform: () => void;
  isUsed: () => boolean;
}

function buildCapabilityHints(t: ReturnType<typeof useT>): CapabilityHint[] {
  return [
    {
      id: "hub.cap.activityHeatmap",
      label: t["hub.cap.activityHeatmap"],
      shortcutKey: "toggleActivityHeatmap",
      perform: () => {
        usePreferencesStore.getState().setActivityHeatmapEnabled(true);
        usePreferencesStore.getState().markHintSeen("hub.cap.activityHeatmap");
      },
      isUsed: () =>
        usePreferencesStore.getState().activityHeatmapEnabled === true,
    },
    {
      id: "hub.cap.statusDigest",
      label: t["hub.cap.statusDigest"],
      shortcutLiteral: "⌘⇧/",
      perform: () => {
        useStatusDigestStore.getState().openDigest();
        usePreferencesStore.getState().markHintSeen("hub.cap.statusDigest");
      },
      isUsed: () =>
        usePreferencesStore.getState().seenHints["hub.cap.statusDigest"] ===
        true,
    },
    {
      id: "hub.cap.waypoints",
      label: t["hub.cap.waypoints"],
      shortcutLiteral: "⌘⇧1…9",
      perform: () => {
        // No bound action — saving requires a viewport context the user
        // chooses. Open the palette filtered to waypoints so they can pick
        // a slot on demand.
        useCommandPaletteStore.getState().openPalette();
        useCommandPaletteStore.getState().setQuery("waypoint");
        usePreferencesStore.getState().markHintSeen("hub.cap.waypoints");
      },
      isUsed: () => {
        const projects = useProjectStore.getState().projects;
        for (const p of projects) {
          if (p.waypoints && Object.keys(p.waypoints).length > 0) return true;
        }
        return (
          usePreferencesStore.getState().seenHints["hub.cap.waypoints"] === true
        );
      },
    },
    {
      id: "hub.cap.commandPalette",
      label: t["hub.cap.commandPalette"],
      shortcutKey: "commandPalette",
      perform: () => {
        useCommandPaletteStore.getState().openPalette();
        usePreferencesStore.getState().markHintSeen("hub.cap.commandPalette");
      },
      isUsed: () =>
        usePreferencesStore.getState().seenHints["hub.cap.commandPalette"] ===
        true,
    },
  ];
}

function detectIsMac(): boolean {
  if (typeof window === "undefined") return false;
  if (window.termcanvas?.app.platform) {
    return window.termcanvas.app.platform === "darwin";
  }
  return /Mac|iPhone|iPad/.test(window.navigator.userAgent);
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path
        d="M2 2L8 8M8 2L2 8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9 2l5 5-3 1-2 4-1-1-3 3-1-1 3-3-1-1 4-2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WaypointGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 14C8 14 12 9.6 12 6.5C12 4 10.2 2 8 2C5.8 2 4 4 4 6.5C4 9.6 8 14 8 14Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="6.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

interface TerminalTypeBadgeProps {
  type: TerminalType;
}

function TerminalTypeBadge({ type }: TerminalTypeBadgeProps) {
  return (
    <span
      aria-hidden
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold tc-mono"
      style={{
        color: "var(--text-muted)",
        backgroundColor:
          "color-mix(in srgb, var(--text-muted) 10%, transparent)",
      }}
    >
      {TYPE_GLYPH_LETTER[type] ?? "·"}
    </span>
  );
}

interface SectionShellProps {
  eyebrow: string;
  trailing?: ReactNode;
  children: ReactNode;
  empty?: ReactNode;
  showEmpty: boolean;
}

function SectionShell({
  eyebrow,
  trailing,
  children,
  empty,
  showEmpty,
}: SectionShellProps) {
  return (
    <section className="px-4 pt-4 pb-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="tc-eyebrow">{eyebrow}</span>
        {trailing != null && trailing !== "" && (
          <span
            className="tc-meta tc-mono"
            style={{ color: "var(--text-faint)", letterSpacing: 0 }}
          >
            {trailing}
          </span>
        )}
      </div>
      {showEmpty ? (
        <div className="tc-label" style={{ color: "var(--text-faint)" }}>
          {empty}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export function Hub() {
  const t = useT();
  const open = useHubStore((s) => s.open);
  const closeHub = useHubStore((s) => s.closeHub);

  // Bucket-shift counter — re-renders the activity feed when the 30s grid
  // advances, without subscribing to every byte of PTY output. wallTick
  // re-evaluates relative timestamps on the same feed once per second.
  const [bucketTick, setBucketTick] = useState(0);
  const [wallTick, setWallTick] = useState(() => Date.now());

  const projects = useProjectStore((s) => s.projects);
  const focusedProjectId = useProjectStore((s) => s.focusedProjectId);
  const runtimeMap = useTerminalRuntimeStateStore((s) => s.terminals);
  const terminalPinMap = usePinStore((s) => s.terminalPinMap);
  const seenHints = usePreferencesStore((s) => s.seenHints);
  const activityHeatmapEnabled = usePreferencesStore(
    (s) => s.activityHeatmapEnabled,
  );
  const shortcuts = useShortcutStore((s) => s.shortcuts);
  const isMac = detectIsMac();

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    return subscribeBucketUpdates(() => {
      setBucketTick((n) => n + 1);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setWallTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeHub();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, closeHub]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      // Ignore the toolbar Hub-toggle so a click on the trigger toggles
      // rather than closing-then-reopening.
      const trigger = document.querySelector("[data-hub-trigger='true']");
      if (trigger?.contains(target)) return;
      closeHub();
    };
    // Defer the click-outside listener by one frame so the same click that
    // opened the hub doesn't immediately close it.
    const id = window.requestAnimationFrame(() => {
      window.addEventListener("mousedown", handler);
    });
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("mousedown", handler);
    };
  }, [open, closeHub]);

  // Index terminals once per render so each section reads from a single
  // resolved view.
  const terminalIndex = useMemo(
    () => buildResolvedTerminalIndex(projects, runtimeMap),
    [projects, runtimeMap],
  );

  // Recent activity slice — bucketTick re-runs on grid shift, wallTick on
  // each second so labels stay live.
  const recentEntries = useMemo(() => {
    void bucketTick;
    void wallTick;
    return getRecentActivity({
      windowMs: ACTIVITY_WINDOW_MS,
      limit: ACTIVITY_FEED_LIMIT * 2,
      now: Date.now(),
    });
  }, [bucketTick, wallTick]);

  const summary = useMemo(() => {
    const latest = recentEntries[0]?.lastActivityAt ?? null;
    return summarizeTerminals(terminalIndex, latest);
  }, [terminalIndex, recentEntries]);

  // Filter activity to entries whose terminals still exist, then truncate.
  const activityRows = useMemo(() => {
    const out: Array<{
      slot: ResolvedTerminalSlot;
      lastActivityAt: number;
    }> = [];
    for (const entry of recentEntries) {
      const slot = terminalIndex.get(entry.terminalId);
      if (!slot) continue;
      out.push({ slot, lastActivityAt: entry.lastActivityAt });
      if (out.length >= ACTIVITY_FEED_LIMIT) break;
    }
    return out;
  }, [recentEntries, terminalIndex]);

  // Waypoints scoped to the active project (mirrors the chord behaviour —
  // ⌥1..9 always recalls from the active project).
  const waypointSection = useMemo(() => {
    void focusedProjectId;
    const projectId = getActiveWaypointProjectId();
    if (!projectId) return null;
    const project = projects.find((p) => p.id === projectId);
    if (!project) return null;
    const rows: Array<{
      slot: SpatialWaypointSlot;
      savedAt: number;
    }> = [];
    for (const slot of WAYPOINT_SLOTS) {
      const wp = project.waypoints?.[slot];
      if (wp) rows.push({ slot, savedAt: wp.savedAt });
    }
    return { projectName: project.name, rows };
  }, [projects, focusedProjectId]);

  const pinnedRows = useMemo(() => {
    const rows: Array<{
      slot: ResolvedTerminalSlot;
      pinTitle: string;
    }> = [];
    for (const [terminalId, assignment] of Object.entries(terminalPinMap)) {
      const slot = terminalIndex.get(terminalId);
      if (!slot) continue;
      rows.push({ slot, pinTitle: assignment.title });
    }
    rows.sort((a, b) => a.pinTitle.localeCompare(b.pinTitle));
    return rows;
  }, [terminalPinMap, terminalIndex]);

  const capabilityRows = useMemo(() => {
    void seenHints;
    void activityHeatmapEnabled;
    void projects;
    return buildCapabilityHints(t).filter((hint) => !hint.isUsed());
  }, [seenHints, activityHeatmapEnabled, projects, t]);

  const handleNavigateToTerminal = useCallback(
    (terminalId: string) => {
      closeHub();
      panToTerminal(terminalId);
    },
    [closeHub],
  );

  const handleRecallWaypoint = useCallback(
    (slot: SpatialWaypointSlot) => {
      closeHub();
      recallWaypointFromActiveProject(slot);
    },
    [closeHub],
  );

  const lastActivityLabel = summary.lastActivityAt
    ? formatRelativeTime(t, wallTick, summary.lastActivityAt)
    : null;

  return (
    <div
      ref={containerRef}
      role="complementary"
      aria-label={`${t["hub.title"]} ${t["hub.subtitle"]}`}
      aria-hidden={!open}
      className="fixed right-0 z-[60] flex flex-col"
      style={{
        top: TOOLBAR_INSET,
        height: `calc(100vh - ${TOOLBAR_INSET}px)`,
        width: HUB_WIDTH,
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        boxShadow: open ? "var(--shadow-elev-2)" : "none",
        transform: open ? "translateX(0)" : `translateX(${HUB_WIDTH + 24}px)`,
        opacity: open ? 1 : 0,
        transition:
          "transform var(--duration-deliberate) var(--ease-out-soft), opacity var(--duration-natural) var(--ease-out-soft), box-shadow var(--duration-natural) var(--ease-out-soft)",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <header
        className="flex items-center justify-between px-4 pt-3 pb-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-baseline gap-2">
          <span
            className="tc-display"
            style={{
              fontSize: "15px",
              letterSpacing: "var(--tracking-title)",
            }}
          >
            {t["hub.title"]}
          </span>
          <span className="tc-eyebrow">{t["hub.subtitle"]}</span>
        </div>
        <button
          type="button"
          onClick={closeHub}
          aria-label={t["hub.close"]}
          className="tc-row-icon inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Active strip — Tier 1 of the visual hierarchy. Bold count,
            quieter context, single line. */}
        <section className="px-4 pt-4 pb-4">
          <div className="tc-eyebrow mb-2">{t["hub.section.active"]}</div>
          <div className="flex items-baseline gap-2">
            <span
              className="tc-stat-lg"
              style={{
                color:
                  summary.running > 0
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
              }}
            >
              {summary.running}
            </span>
            <span className="tc-ui" style={{ color: "var(--text-secondary)" }}>
              {t["hub.active.running"]}
            </span>
            <span
              className="tc-meta ml-auto tc-mono tabular-nums"
              style={{ color: "var(--text-metadata)", letterSpacing: 0 }}
            >
              {t["hub.active.totalTerminals"](summary.total)}
            </span>
          </div>
          <div
            className="tc-label mt-1.5 flex items-center gap-2"
            style={{ color: "var(--text-muted)" }}
          >
            {summary.running > 0 && (
              <span
                aria-hidden
                className="status-pulse inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
            )}
            <span>
              {lastActivityLabel
                ? t["hub.active.lastActivity"](lastActivityLabel)
                : t["hub.active.quiet"]}
            </span>
          </div>
        </section>

        <div style={{ borderTop: "1px solid var(--border)" }} />

        <SectionShell
          eyebrow={t["hub.section.recentActivity"]}
          trailing={
            activityRows.length > 0
              ? t["hub.recentActivity.trailing"](activityRows.length)
              : undefined
          }
          empty={t["hub.recentActivity.empty"]}
          showEmpty={activityRows.length === 0}
        >
          <ul className="-mx-1">
            {activityRows.map(({ slot, lastActivityAt }) => {
              const tone = STATUS_TONE[slot.resolvedStatus];
              const buckets = getActivityBuckets(slot.terminal.id, wallTick);
              const label =
                slot.terminal.customTitle ||
                slot.terminal.title ||
                slot.terminal.type;
              return (
                <li key={slot.terminal.id}>
                  <button
                    type="button"
                    onClick={() => handleNavigateToTerminal(slot.terminal.id)}
                    className="tc-row-hover flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
                  >
                    <TerminalTypeBadge type={slot.terminal.type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="tc-ui truncate"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {label}
                        </span>
                        <span
                          aria-hidden
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone.pulse ? "status-pulse" : ""}`}
                          style={{ background: tone.color }}
                          title={t[tone.labelKey]}
                        />
                      </div>
                      <div
                        className="tc-meta truncate"
                        style={{ color: "var(--text-metadata)" }}
                      >
                        {slot.projectName} · {slot.worktreeName}
                      </div>
                    </div>
                    <Sparkline buckets={buckets} />
                    <span
                      className="tc-timestamp shrink-0 tabular-nums"
                      style={{
                        color: "var(--text-faint)",
                        minWidth: 38,
                        textAlign: "right",
                      }}
                    >
                      {formatRelativeTime(t, wallTick, lastActivityAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </SectionShell>

        <div style={{ borderTop: "1px solid var(--border)" }} />

        <SectionShell
          eyebrow={t["hub.section.waypoints"]}
          trailing={waypointSection?.projectName}
          empty={
            waypointSection
              ? t["hub.waypoints.empty"]
              : t["hub.waypoints.noProject"]
          }
          showEmpty={!waypointSection || waypointSection.rows.length === 0}
        >
          {waypointSection && waypointSection.rows.length > 0 && (
            <ul className="-mx-1">
              {waypointSection.rows.map(({ slot, savedAt }) => (
                <li key={slot}>
                  <button
                    type="button"
                    onClick={() => handleRecallWaypoint(slot)}
                    className="tc-row-hover flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)]"
                      aria-hidden
                    >
                      <WaypointGlyph />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className="tc-ui truncate"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {t["hub.waypoints.row"](Number(slot))}
                      </div>
                      <div
                        className="tc-meta truncate"
                        style={{ color: "var(--text-metadata)" }}
                      >
                        {t["hub.waypoints.savedAt"](
                          formatRelativeTime(t, wallTick, savedAt),
                        )}
                      </div>
                    </div>
                    <kbd
                      className="tc-kbd shrink-0"
                      style={{
                        fontSize: "10px",
                        padding: "1px 6px",
                        letterSpacing: 0,
                      }}
                    >
                      ⌥{slot}
                    </kbd>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionShell>

        <div style={{ borderTop: "1px solid var(--border)" }} />

        <SectionShell
          eyebrow={t["hub.section.pinned"]}
          trailing={
            pinnedRows.length > 0
              ? t["hub.pinned.count"](pinnedRows.length)
              : undefined
          }
          empty={t["hub.pinned.empty"]}
          showEmpty={pinnedRows.length === 0}
        >
          <ul className="-mx-1">
            {pinnedRows.map(({ slot, pinTitle }) => {
              const tone = STATUS_TONE[slot.resolvedStatus];
              const label =
                slot.terminal.customTitle ||
                slot.terminal.title ||
                slot.terminal.type;
              return (
                <li key={slot.terminal.id}>
                  <button
                    type="button"
                    onClick={() => handleNavigateToTerminal(slot.terminal.id)}
                    className="tc-row-hover flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)]"
                      aria-hidden
                    >
                      <PinGlyph />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="tc-ui truncate"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {pinTitle}
                        </span>
                        <span
                          aria-hidden
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone.pulse ? "status-pulse" : ""}`}
                          style={{ background: tone.color }}
                          title={t[tone.labelKey]}
                        />
                      </div>
                      <div
                        className="tc-meta truncate"
                        style={{ color: "var(--text-metadata)" }}
                      >
                        {label} · {slot.projectName}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </SectionShell>

        {capabilityRows.length > 0 && (
          <>
            <div style={{ borderTop: "1px solid var(--border)" }} />
            <SectionShell
              eyebrow={t["hub.section.tryNext"]}
              empty=""
              showEmpty={false}
            >
              <ul className="-mx-1">
                {capabilityRows.slice(0, 4).map((hint) => {
                  const chord = hint.shortcutKey
                    ? formatShortcut(shortcuts[hint.shortcutKey], isMac)
                    : hint.shortcutLiteral;
                  return (
                    <li key={hint.id}>
                      <button
                        type="button"
                        onClick={hint.perform}
                        className="tc-row-hover flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
                      >
                        <span
                          aria-hidden
                          className="inline-block h-1 w-1 shrink-0 rounded-full"
                          style={{ background: "var(--accent)", opacity: 0.5 }}
                        />
                        <span
                          className="tc-meta flex-1 truncate"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {hint.label}
                        </span>
                        {chord && (
                          <kbd
                            className="tc-kbd shrink-0"
                            style={{
                              fontSize: "10px",
                              padding: "1px 6px",
                              letterSpacing: 0,
                            }}
                          >
                            {chord}
                          </kbd>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </SectionShell>
          </>
        )}

        <div className="h-3" />
      </div>

      <footer
        className="flex items-center gap-3 px-4 py-2"
        style={{
          borderTop: "1px solid var(--border)",
          color: "var(--text-faint)",
        }}
      >
        <span className="tc-timestamp" style={{ color: "var(--text-faint)" }}>
          {formatShortcut(shortcuts.toggleHub, isMac)}
        </span>
        <span className="tc-timestamp" style={{ color: "var(--text-faint)" }}>
          {t["hub.toggle"]}
        </span>
        <span
          className="tc-timestamp ml-auto"
          style={{ color: "var(--text-faint)" }}
        >
          {t["hub.escCloses"]}
        </span>
      </footer>
    </div>
  );
}
