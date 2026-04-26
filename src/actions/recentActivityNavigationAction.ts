import { useProjectStore } from "../stores/projectStore";
import { getRecentActivity } from "../terminal/terminalActivityTracker";
import { panToTerminal } from "../utils/panToTerminal";

export const RECENT_ACTIVITY_WINDOW_MS = 30_000;
export const RECENT_ACTIVITY_FLY_DURATION_MS = 320;

// Quick-presses within this window cycle through the snapshot taken on the
// first press (Alt+Tab semantics). After this window of idle, the next press
// recomputes recency from scratch.
const CYCLE_RESET_MS = 2_000;
const MAX_LRU = 8;

export const RECENT_ACTIVITY_FLOWN_EVENT = "termcanvas:recent-activity-flown";
export const RECENT_ACTIVITY_NOOP_EVENT = "termcanvas:recent-activity-noop";

export interface RecentActivityFlownDetail {
  terminalId: string;
  cursor: number;
  total: number;
}

export interface RecentActivityNoopDetail {
  reason: "no_activity" | "no_targets";
}

function easeOutSoft(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

interface CycleState {
  snapshot: string[];
  cursor: number;
  lastPressAt: number;
}

let cycleState: CycleState | null = null;

function findFocusedTerminalId(): string | null {
  const { projects } = useProjectStore.getState();
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.focused) return t.id;
      }
    }
  }
  return null;
}

function isTerminalLive(terminalId: string): boolean {
  const { projects } = useProjectStore.getState();
  for (const p of projects) {
    for (const w of p.worktrees) {
      for (const t of w.terminals) {
        if (t.id === terminalId) return !t.stashed;
      }
    }
  }
  return false;
}

function buildSnapshot(now: number, focusedId: string | null): string[] {
  const recent = getRecentActivity({
    windowMs: RECENT_ACTIVITY_WINDOW_MS,
    now,
    limit: MAX_LRU,
  });
  const ids: string[] = [];
  for (const entry of recent) {
    if (entry.terminalId === focusedId) continue;
    if (!isTerminalLive(entry.terminalId)) continue;
    ids.push(entry.terminalId);
  }
  return ids;
}

function emitFlown(detail: RecentActivityFlownDetail): void {
  window.dispatchEvent(
    new CustomEvent<RecentActivityFlownDetail>(RECENT_ACTIVITY_FLOWN_EVENT, {
      detail,
    }),
  );
}

function emitNoop(reason: RecentActivityNoopDetail["reason"]): void {
  window.dispatchEvent(
    new CustomEvent<RecentActivityNoopDetail>(RECENT_ACTIVITY_NOOP_EVENT, {
      detail: { reason },
    }),
  );
}

/**
 * Fly the camera to whichever terminal emitted output most recently.
 * Repeated presses within CYCLE_RESET_MS cycle through the LRU snapshot
 * captured on the first press. Returns the terminal flown to, or null
 * when nothing recent is in window.
 */
export function panToRecentActivity(now: number = Date.now()): string | null {
  const focusedId = findFocusedTerminalId();
  const isCycling =
    cycleState !== null && now - cycleState.lastPressAt <= CYCLE_RESET_MS;

  let snapshot: string[];
  let cursor: number;
  if (isCycling && cycleState) {
    snapshot = cycleState.snapshot.filter(isTerminalLive);
    if (snapshot.length === 0) {
      cycleState = null;
      return panToRecentActivity(now);
    }
    cursor = (cycleState.cursor + 1) % snapshot.length;
  } else {
    snapshot = buildSnapshot(now, focusedId);
    cursor = 0;
  }

  if (snapshot.length === 0) {
    cycleState = null;
    emitNoop(focusedId ? "no_targets" : "no_activity");
    return null;
  }

  const terminalId = snapshot[cursor];
  cycleState = {
    snapshot,
    cursor,
    lastPressAt: now,
  };

  panToTerminal(terminalId, {
    preserveScale: true,
    duration: RECENT_ACTIVITY_FLY_DURATION_MS,
    easing: easeOutSoft,
  });
  emitFlown({ terminalId, cursor, total: snapshot.length });
  return terminalId;
}

export function resetRecentActivityCycleForTesting(): void {
  cycleState = null;
}
