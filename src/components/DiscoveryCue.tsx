import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../i18n/useT";
import { TOOLBAR_HEIGHT } from "../toolbar/toolbarHeight";
import {
  useCanvasStore,
  COLLAPSED_TAB_WIDTH,
} from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { usePreferencesStore } from "../stores/preferencesStore";
import { useNotificationStore } from "../stores/notificationStore";
import { usePinStore } from "../stores/pinStore";
import { useSearchStore } from "../stores/searchStore";
import { useCommandPaletteStore } from "../stores/commandPaletteStore";
import { useStatusDigestStore } from "../stores/statusDigestStore";
import { useSnapshotHistoryStore } from "../stores/snapshotHistoryStore";
import { useHubStore } from "../stores/hubStore";
import { getRecentActivity } from "../terminal/terminalActivityTracker";

/**
 * Quiet capability discovery — one chip at a time, top-center of the
 * canvas, in the negative space. Each cue declares the conditions under
 * which it should appear; the renderer picks the highest-priority active
 * cue and fades it in. Acting on the cue (or dismissing it) writes a flag
 * to `seenHints`, after which the same cue never reappears for this user.
 *
 * Tone goals:
 *  - Default state is barely there. Hover lifts contrast a notch.
 *  - One cue at a time. Two coincident cues never stack.
 *  - The cue itself is the action. No "learn more" indirection.
 */

interface CueViewModel {
  id: string;
  // Higher wins when multiple cues qualify in the same render. Numbers
  // are spaced so new cues can slot between existing ones without a
  // global renumber.
  priority: number;
  message: ReactNode;
  action: { label: string; onClick: () => void };
}

function useTotalTerminalCount(): number {
  return useProjectStore((s) =>
    s.projects.reduce(
      (sum, p) =>
        sum + p.worktrees.reduce((s2, w) => s2 + w.terminals.length, 0),
      0,
    ),
  );
}

// zustand v5 useStore has no equality argument — a selector that returns a
// new object every call trips useSyncExternalStore's tearing detection and
// loops until React's update-depth limit. Read each field with its own
// primitive selector so subscribers compare by value, then assemble the
// view-model afterwards (cheap, not subscribed).
function useFocusedProjectSnapshot():
  | { id: string; path: string; terminalCount: number }
  | null {
  const focusedId = useProjectStore((s) => s.focusedProjectId);
  const path = useProjectStore((s) => {
    if (!s.focusedProjectId) return null;
    return s.projects.find((p) => p.id === s.focusedProjectId)?.path ?? null;
  });
  const terminalCount = useProjectStore((s) => {
    if (!s.focusedProjectId) return 0;
    const p = s.projects.find((pr) => pr.id === s.focusedProjectId);
    return p?.worktrees.reduce((sum, w) => sum + w.terminals.length, 0) ?? 0;
  });
  if (!focusedId || !path) return null;
  return { id: focusedId, path, terminalCount };
}

const CUE_ID_SEARCH = "discover-search";
const CUE_ID_PINNING = "discover-pinning";
const CUE_ID_HYDRA = "discover-hydra";
const CUE_ID_PALETTE = "discover-palette";
const CUE_ID_PAN_RECENT = "discover-pan-recent";
const CUE_ID_DIGEST = "discover-digest";
const CUE_ID_HUB = "discover-hub";
const CUE_ID_SNAPSHOT = "discover-snapshot-history";

// Trigger thresholds. Tuned to match each capability's true sweet-spot —
// the moment when the cue would actually save the user a step rather
// than nag them with something they don't yet need.
const SEARCH_TRIGGER_THRESHOLD = 5;
const PINNING_TRIGGER_THRESHOLD = 3;
const PALETTE_TRIGGER_THRESHOLD = 5;
const PAN_RECENT_TRIGGER_THRESHOLD = 3;
const PAN_RECENT_SOURCES_REQUIRED = 2;
const PAN_RECENT_WINDOW_MS = 30_000;
const PAN_RECENT_POLL_MS = 5_000;
const DIGEST_TRIGGER_THRESHOLD = 5;
const DIGEST_ACTIVITY_WINDOW_MS = 5 * 60_000;
const DIGEST_POLL_MS = 15_000;
const HUB_PROJECT_THRESHOLD = 2;
const SNAPSHOT_ENTRY_THRESHOLD = 3;

// Priority bands. Higher = preempts lower when both qualify. Spacing
// leaves room to slot new cues without renumbering existing ones.
const PRIORITY_HYDRA = 100;
const PRIORITY_PAN_RECENT = 90;
const PRIORITY_PINNING = 80;
const PRIORITY_DIGEST = 70;
const PRIORITY_HUB = 60;
const PRIORITY_PALETTE = 50;
const PRIORITY_SEARCH = 45;
const PRIORITY_SNAPSHOT = 40;

function useSearchDiscoveryCue(): CueViewModel | null {
  const t = useT();
  const totalTerminals = useTotalTerminalCount();
  const seen = usePreferencesStore((s) => s.seenHints[CUE_ID_SEARCH] === true);
  const enabled = usePreferencesStore((s) => s.globalSearchEnabled);
  const setEnabled = usePreferencesStore((s) => s.setGlobalSearchEnabled);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);

  if (seen) return null;
  if (enabled) return null;
  if (totalTerminals < SEARCH_TRIGGER_THRESHOLD) return null;

  return {
    id: CUE_ID_SEARCH,
    priority: PRIORITY_SEARCH,
    message: t["discovery.search.message"](totalTerminals),
    action: {
      label: t["discovery.search.action"],
      onClick: () => {
        setEnabled(true);
        useSearchStore.getState().openSearch();
        markSeen(CUE_ID_SEARCH);
      },
    },
  };
}

function usePinningDiscoveryCue(): CueViewModel | null {
  const t = useT();
  const focused = useFocusedProjectSnapshot();
  // Retire the cue once the user has any pin in any project — pinning is
  // a concept, not a per-project tutorial. One pin proves discovery.
  const totalPins = usePinStore((s) =>
    Object.values(s.pinsByProject).reduce((sum, list) => sum + list.length, 0),
  );
  const drawerOpenFor = usePinStore((s) => s.openProjectPath);
  const seen = usePreferencesStore((s) => s.seenHints[CUE_ID_PINNING] === true);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);

  if (seen) return null;
  if (!focused) return null;
  if (focused.terminalCount < PINNING_TRIGGER_THRESHOLD) return null;
  if (totalPins > 0) return null;
  // If the drawer is already open, the user has discovered it — silence.
  if (drawerOpenFor === focused.path) return null;

  return {
    id: CUE_ID_PINNING,
    priority: PRIORITY_PINNING,
    message: t["discovery.pinning.message"],
    action: {
      label: t["discovery.pinning.action"],
      onClick: () => {
        usePinStore.getState().openDrawer(focused.path);
        markSeen(CUE_ID_PINNING);
      },
    },
  };
}

function useHydraDiscoveryCue(): CueViewModel | null {
  const t = useT();
  const focused = useFocusedProjectSnapshot();
  const seen = usePreferencesStore((s) => s.seenHints[CUE_ID_HYDRA] === true);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);
  const notify = useNotificationStore((s) => s.notify);

  const [status, setStatus] = useState<"missing" | "outdated" | null>(null);
  const [busy, setBusy] = useState(false);
  const projectPath = focused?.path ?? null;
  const projectName = useProjectStore(
    (s) => s.projects.find((p) => p.id === focused?.id)?.name ?? null,
  );

  useEffect(() => {
    if (seen) return;
    if (!projectPath) {
      setStatus(null);
      return;
    }
    const api = window.termcanvas?.project?.checkHydra;
    if (!api) return;
    let cancelled = false;
    api(projectPath)
      .then((next) => {
        if (cancelled) return;
        setStatus(next === "missing" || next === "outdated" ? next : null);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, seen]);

  if (seen) return null;
  if (!projectPath || !projectName) return null;
  if (!status) return null;

  const message =
    status === "outdated"
      ? t["discovery.hydra.outdated.message"]
      : t["discovery.hydra.missing.message"];
  const label =
    status === "outdated"
      ? t["discovery.hydra.outdated.action"]
      : t["discovery.hydra.missing.action"];

  return {
    id: CUE_ID_HYDRA,
    priority: PRIORITY_HYDRA,
    message,
    action: {
      label: busy ? "…" : label,
      onClick: () => {
        if (busy) return;
        const enableApi = window.termcanvas?.project?.enableHydra;
        if (!enableApi) return;
        setBusy(true);
        enableApi(projectPath)
          .then((result) => {
            if (!result.ok) {
              notify("error", t.hydra_enable_failed(result.error));
              return;
            }
            notify(
              "info",
              result.changed
                ? t.hydra_enable_success(projectName)
                : t.hydra_enable_already_current(projectName),
            );
            setStatus(null);
            markSeen(CUE_ID_HYDRA);
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            notify("error", t.hydra_enable_failed(msg));
          })
          .finally(() => setBusy(false));
      },
    },
  };
}

function usePaletteDiscoveryCue(): CueViewModel | null {
  const t = useT();
  const totalTerminals = useTotalTerminalCount();
  const seen = usePreferencesStore((s) => s.seenHints[CUE_ID_PALETTE] === true);
  // hasOpenedOnce is session-only; if the user has already opened the
  // palette in this session they don't need a cue for it. After dismissal
  // or action, seenHints persists across sessions and gates re-display.
  const hasOpenedOnce = useCommandPaletteStore((s) => s.hasOpenedOnce);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);

  if (seen) return null;
  if (hasOpenedOnce) return null;
  if (totalTerminals < PALETTE_TRIGGER_THRESHOLD) return null;

  return {
    id: CUE_ID_PALETTE,
    priority: PRIORITY_PALETTE,
    message: t["discovery.palette.message"],
    action: {
      label: t["discovery.palette.action"],
      onClick: () => {
        useCommandPaletteStore.getState().openPalette();
        markSeen(CUE_ID_PALETTE);
      },
    },
  };
}

function usePanToRecentActivityCue(): CueViewModel | null {
  const t = useT();
  const totalTerminals = useTotalTerminalCount();
  const seen = usePreferencesStore(
    (s) => s.seenHints[CUE_ID_PAN_RECENT] === true,
  );
  const markSeen = usePreferencesStore((s) => s.markHintSeen);
  // terminalActivityTracker lives outside zustand on purpose (hot
  // write path), so we sample it on a low-frequency tick. Skip the
  // poll entirely when the cue can't fire.
  const [hasMultipleSources, setHasMultipleSources] = useState(false);

  const eligible = !seen && totalTerminals >= PAN_RECENT_TRIGGER_THRESHOLD;

  useEffect(() => {
    if (!eligible) {
      setHasMultipleSources(false);
      return;
    }
    const check = () => {
      const recent = getRecentActivity({
        windowMs: PAN_RECENT_WINDOW_MS,
        now: Date.now(),
      });
      setHasMultipleSources(recent.length >= PAN_RECENT_SOURCES_REQUIRED);
    };
    check();
    const handle = window.setInterval(check, PAN_RECENT_POLL_MS);
    return () => window.clearInterval(handle);
  }, [eligible]);

  if (!eligible) return null;
  if (!hasMultipleSources) return null;

  return {
    id: CUE_ID_PAN_RECENT,
    priority: PRIORITY_PAN_RECENT,
    message: t["discovery.panRecent.message"],
    action: {
      label: t["discovery.panRecent.action"],
      onClick: () => {
        // Lazy import to avoid a static cycle with the action layer.
        void import("../actions/recentActivityNavigationAction").then(
          ({ panToRecentActivity }) => {
            panToRecentActivity();
          },
        );
        markSeen(CUE_ID_PAN_RECENT);
      },
    },
  };
}

function useDigestDiscoveryCue(): CueViewModel | null {
  const t = useT();
  const totalTerminals = useTotalTerminalCount();
  const seen = usePreferencesStore(
    (s) => s.seenHints[CUE_ID_DIGEST] === true,
  );
  const open = useStatusDigestStore((s) => s.open);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);

  // Only fire when there's *something* for the digest to actually show —
  // a quiet canvas with five idle terminals would be a hollow nudge.
  // Activity within the last 5 min is the cheap proxy for "the digest
  // would compute non-empty signals right now".
  const [hasRecentActivity, setHasRecentActivity] = useState(false);

  const eligible = !seen && !open && totalTerminals >= DIGEST_TRIGGER_THRESHOLD;

  useEffect(() => {
    if (!eligible) {
      setHasRecentActivity(false);
      return;
    }
    const check = () => {
      const recent = getRecentActivity({
        windowMs: DIGEST_ACTIVITY_WINDOW_MS,
        now: Date.now(),
      });
      setHasRecentActivity(recent.length > 0);
    };
    check();
    const handle = window.setInterval(check, DIGEST_POLL_MS);
    return () => window.clearInterval(handle);
  }, [eligible]);

  if (!eligible) return null;
  if (!hasRecentActivity) return null;

  return {
    id: CUE_ID_DIGEST,
    priority: PRIORITY_DIGEST,
    message: t["discovery.digest.message"],
    action: {
      label: t["discovery.digest.action"],
      onClick: () => {
        useStatusDigestStore.getState().openDigest();
        markSeen(CUE_ID_DIGEST);
      },
    },
  };
}

function useHubDiscoveryCue(): CueViewModel | null {
  const t = useT();
  const seen = usePreferencesStore((s) => s.seenHints[CUE_ID_HUB] === true);
  const open = useHubStore((s) => s.open);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);
  // Hub earns its keep once the user is juggling two or more projects on
  // the canvas — that's the moment a cross-project view starts paying off.
  const projectsWithTerminals = useProjectStore(
    (s) =>
      s.projects.filter((p) =>
        p.worktrees.some((w) => w.terminals.length > 0),
      ).length,
  );

  if (seen) return null;
  if (open) return null;
  if (projectsWithTerminals < HUB_PROJECT_THRESHOLD) return null;

  return {
    id: CUE_ID_HUB,
    priority: PRIORITY_HUB,
    message: t["discovery.hub.message"],
    action: {
      label: t["discovery.hub.action"],
      onClick: () => {
        useHubStore.getState().openHub();
        markSeen(CUE_ID_HUB);
      },
    },
  };
}

function useSnapshotHistoryDiscoveryCue(): CueViewModel | null {
  const t = useT();
  const seen = usePreferencesStore(
    (s) => s.seenHints[CUE_ID_SNAPSHOT] === true,
  );
  const open = useSnapshotHistoryStore((s) => s.open);
  const entryCount = useSnapshotHistoryStore((s) => s.entries.length);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);

  if (seen) return null;
  if (open) return null;
  // Snapshot autosave throttles to one every 5 min while the canvas is
  // dirty. Three entries means the user has worked through ~15 min of
  // edits — enough that "roll back" starts being a real lever.
  if (entryCount < SNAPSHOT_ENTRY_THRESHOLD) return null;

  return {
    id: CUE_ID_SNAPSHOT,
    priority: PRIORITY_SNAPSHOT,
    message: t["discovery.snapshot.message"],
    action: {
      label: t["discovery.snapshot.action"],
      onClick: () => {
        useSnapshotHistoryStore.getState().openHistory();
        markSeen(CUE_ID_SNAPSHOT);
      },
    },
  };
}

export function DiscoveryCue() {
  const t = useT();
  // Hooks run unconditionally and in stable order; each returns null
  // when its conditions aren't met. We then pick the highest-priority
  // active cue so two coincident cues never stack.
  const candidates: Array<CueViewModel | null> = [
    useHydraDiscoveryCue(),
    usePanToRecentActivityCue(),
    usePinningDiscoveryCue(),
    useDigestDiscoveryCue(),
    useHubDiscoveryCue(),
    usePaletteDiscoveryCue(),
    useSearchDiscoveryCue(),
    useSnapshotHistoryDiscoveryCue(),
  ];

  let topCue: CueViewModel | null = null;
  for (const c of candidates) {
    if (!c) continue;
    if (topCue === null || c.priority > topCue.priority) topCue = c;
  }

  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
  const markSeen = usePreferencesStore((s) => s.markHintSeen);

  if (!topCue) return null;
  const cue = topCue;

  const leftInset = leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;
  const rightInset = rightPanelCollapsed
    ? COLLAPSED_TAB_WIDTH
    : rightPanelWidth;

  return (
    <div
      className="fixed pointer-events-none flex justify-center"
      style={{
        top: TOOLBAR_HEIGHT + 12,
        left: leftInset,
        right: rightInset,
        zIndex: 30,
      }}
    >
      <div
        key={cue.id}
        role="status"
        className="tc-enter-fade-up tc-discovery-chip pointer-events-auto group flex items-center gap-2.5 rounded-full border px-3 py-1 backdrop-blur-sm"
      >
        <span
          aria-hidden
          className="inline-block w-1 h-1 rounded-full shrink-0"
          style={{ background: "var(--accent)", opacity: 0.65 }}
        />
        <span className="tc-meta whitespace-nowrap">{cue.message}</span>
        <button
          type="button"
          onClick={cue.action.onClick}
          className="tc-eyebrow rounded px-1.5 py-0.5 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
          style={{
            color: "var(--accent)",
            transitionDuration: "var(--duration-instant)",
          }}
        >
          {cue.action.label}
        </button>
        <button
          type="button"
          onClick={() => markSeen(cue.id)}
          aria-label={t["discovery.dismiss"]}
          className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-0.5 -mr-1"
          style={{ transitionDuration: "var(--duration-quick)" }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 2L8 8M8 2L2 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
