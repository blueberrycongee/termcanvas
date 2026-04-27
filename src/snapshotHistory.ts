import { en } from "./i18n/en";
import { zh } from "./i18n/zh";
import { useLocaleStore } from "./stores/localeStore";
import { useProjectStore } from "./stores/projectStore";
import { snapshotState } from "./snapshotState";
import {
  useSnapshotHistoryStore,
  type SnapshotHistoryEntry,
} from "./stores/snapshotHistoryStore";

function dict() {
  const locale = useLocaleStore.getState().locale;
  return locale === "zh" ? { ...en, ...zh } : en;
}

interface CountStats {
  terminalCount: number;
  projectCount: number;
}

/**
 * Smallest interval between two history captures. Auto-save itself fires every
 * five seconds while the canvas is dirty; without a floor we'd burn through the
 * 20-slot ring buffer in under two minutes of active editing. Five minutes
 * matches the "what did the canvas look like an hour ago / yesterday" use case
 * the browser is built for, while still capturing accidental destructive edits
 * before the next checkpoint.
 */
const MIN_HISTORY_INTERVAL_MS = 5 * 60 * 1000;

let lastHistoryWriteAt = 0;

function countCanvas(): CountStats {
  const { projects } = useProjectStore.getState();
  let terminalCount = 0;
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      terminalCount += worktree.terminals.length;
    }
  }
  return { terminalCount, projectCount: projects.length };
}

function deriveLabel(prev: CountStats | null, next: CountStats): string {
  const t = dict();
  if (!prev) return t["snapshot.label.summary"](next.terminalCount, next.projectCount);
  const dt = next.terminalCount - prev.terminalCount;
  const dp = next.projectCount - prev.projectCount;
  if (dt > 0) return t["snapshot.label.added_terminals"](dt);
  if (dt < 0) return t["snapshot.label.closed_terminals"](-dt);
  if (dp > 0) return t["snapshot.label.added_projects"](dp);
  if (dp < 0) return t["snapshot.label.removed_projects"](-dp);
  return t["snapshot.label.summary"](next.terminalCount, next.projectCount);
}

let lastStats: CountStats | null = null;

interface AppendOptions {
  /** Bypass the throttle floor — used by manual "Save snapshot now" actions. */
  force?: boolean;
}

/**
 * Append a snapshot of current canvas state to the history ring buffer.
 *
 * Returns the entry that was written, or `null` if throttled / unavailable.
 * Throttle floor is `MIN_HISTORY_INTERVAL_MS`; pass `{ force: true }` to skip
 * it (e.g. user-initiated mark, or just before a destructive action).
 */
export async function appendSnapshotToHistory(
  options: AppendOptions = {},
): Promise<SnapshotHistoryEntry | null> {
  if (!window.termcanvas?.snapshots) return null;

  const now = Date.now();
  if (!options.force && now - lastHistoryWriteAt < MIN_HISTORY_INTERVAL_MS) {
    return null;
  }

  const stats = countCanvas();
  // Skip writing an empty canvas as the very first history entry — there's
  // nothing useful to restore to. Once the user has done anything we'll
  // start capturing.
  if (
    !options.force &&
    lastStats === null &&
    stats.terminalCount === 0 &&
    stats.projectCount === 0
  ) {
    return null;
  }

  const label = deriveLabel(lastStats, stats);
  const body = JSON.parse(snapshotState()) as unknown;

  try {
    const entry = await window.termcanvas.snapshots.append({
      savedAt: now,
      terminalCount: stats.terminalCount,
      projectCount: stats.projectCount,
      label,
      body,
    });
    lastHistoryWriteAt = now;
    lastStats = stats;
    useSnapshotHistoryStore.getState().upsertEntry(entry);
    return entry;
  } catch (err) {
    console.error("[snapshotHistory] failed to append entry:", err);
    return null;
  }
}

export function relativeTimeLabel(ms: number, now = Date.now()): string {
  const t = dict();
  const delta = Math.max(0, now - ms);
  const seconds = Math.round(delta / 1000);
  if (seconds < 45) return t["snapshot.relative.justNow"];
  const minutes = Math.round(seconds / 60);
  if (minutes < 2) return t["snapshot.relative.minuteAgo"];
  if (minutes < 60) return t["snapshot.relative.minutesAgo"](minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 2) return t["snapshot.relative.hourAgo"];
  if (hours < 24) return t["snapshot.relative.hoursAgo"](hours);
  const days = Math.round(hours / 24);
  if (days < 2) return t["snapshot.relative.yesterday"];
  if (days < 7) return t["snapshot.relative.daysAgo"](days);
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
