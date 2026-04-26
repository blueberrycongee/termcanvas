// Per-terminal activity ledger. Two surfaces share it:
//
//   1. Pan-to-recent-activity (Alt+`) — needs a single "last output" timestamp.
//   2. Activity heatmap — needs a coarse 5-minute volume profile, bucketed
//      so a steady stream of PTY chunks doesn't trigger React re-renders for
//      every byte. Buckets shift on a 30s grid; subscribers are only
//      notified when the grid advances, not on every record call.
//
// State lives outside zustand for the same reason: the hot write path is
// `handleRuntimeOutput` and we never want it to schedule a render.

export const ACTIVITY_BUCKET_COUNT = 10;
export const ACTIVITY_BUCKET_DURATION_MS = 30_000;
export const ACTIVITY_WINDOW_MS =
  ACTIVITY_BUCKET_COUNT * ACTIVITY_BUCKET_DURATION_MS;

interface BucketState {
  // buckets[0] is the newest (current) bucket; buckets[BUCKET_COUNT-1] is
  // the oldest. Mutated in place — identity stays stable so reads can
  // memoize on the array reference.
  buckets: number[];
  bucketStartedAt: number;
  // Increments every time the bucket grid shifts. Subscribers read this
  // for cheap change detection; within-bucket increments do not bump it.
  version: number;
}

const lastActivityAt = new Map<string, number>();
const bucketStates = new Map<string, BucketState>();
type BucketListener = (terminalId: string) => void;
const bucketListeners = new Set<BucketListener>();

function alignBucketStart(now: number): number {
  return Math.floor(now / ACTIVITY_BUCKET_DURATION_MS) * ACTIVITY_BUCKET_DURATION_MS;
}

function shiftBuckets(state: BucketState, n: number): void {
  if (n >= ACTIVITY_BUCKET_COUNT) {
    state.buckets.fill(0);
    return;
  }
  for (let i = ACTIVITY_BUCKET_COUNT - 1; i >= n; i--) {
    state.buckets[i] = state.buckets[i - n];
  }
  for (let i = 0; i < n; i++) {
    state.buckets[i] = 0;
  }
}

function ensureBucketState(terminalId: string, now: number): BucketState {
  let state = bucketStates.get(terminalId);
  if (!state) {
    state = {
      buckets: new Array(ACTIVITY_BUCKET_COUNT).fill(0),
      bucketStartedAt: alignBucketStart(now),
      version: 0,
    };
    bucketStates.set(terminalId, state);
  }
  return state;
}

function advanceBuckets(
  state: BucketState,
  terminalId: string,
  now: number,
): boolean {
  const currentBucketStart = alignBucketStart(now);
  if (currentBucketStart === state.bucketStartedAt) return false;
  const n = Math.min(
    ACTIVITY_BUCKET_COUNT,
    Math.round(
      (currentBucketStart - state.bucketStartedAt) / ACTIVITY_BUCKET_DURATION_MS,
    ),
  );
  if (n <= 0) return false;
  shiftBuckets(state, n);
  state.bucketStartedAt = currentBucketStart;
  state.version += 1;
  for (const listener of bucketListeners) listener(terminalId);
  return true;
}

export function recordTerminalActivity(
  terminalId: string,
  weight: number = 1,
  now: number = Date.now(),
): void {
  lastActivityAt.set(terminalId, now);
  const state = ensureBucketState(terminalId, now);
  advanceBuckets(state, terminalId, now);
  state.buckets[0] += weight;
}

export function clearTerminalActivity(terminalId: string): void {
  lastActivityAt.delete(terminalId);
  bucketStates.delete(terminalId);
}

export function clearAllTerminalActivity(): void {
  lastActivityAt.clear();
  bucketStates.clear();
}

export interface RecentActivityEntry {
  terminalId: string;
  lastActivityAt: number;
}

export function getRecentActivity(opts: {
  windowMs: number;
  now?: number;
  limit?: number;
}): RecentActivityEntry[] {
  const now = opts.now ?? Date.now();
  const cutoff = now - opts.windowMs;
  const entries: RecentActivityEntry[] = [];
  for (const [terminalId, ts] of lastActivityAt) {
    if (ts >= cutoff) {
      entries.push({ terminalId, lastActivityAt: ts });
    }
  }
  entries.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  if (opts.limit !== undefined && entries.length > opts.limit) {
    return entries.slice(0, opts.limit);
  }
  return entries;
}

// Snapshot the current bucket profile for a terminal. Returns the live
// array reference; do not mutate. Callers should treat the array as
// frozen between bucket-shift notifications. If no activity has ever been
// recorded for this terminal, returns an all-zero snapshot computed
// against `now` so the sparkline can still render an empty baseline.
const EMPTY_BUCKETS: ReadonlyArray<number> = new Array(ACTIVITY_BUCKET_COUNT).fill(0);

export function getActivityBuckets(
  terminalId: string,
  now: number = Date.now(),
): ReadonlyArray<number> {
  const state = bucketStates.get(terminalId);
  if (!state) return EMPTY_BUCKETS;
  // Drop buckets that have aged out without an explicit record() call.
  // This keeps idle terminals' sparklines decaying to flat instead of
  // freezing on the last observed profile.
  advanceBuckets(state, terminalId, now);
  return state.buckets;
}

export function getActivityBucketsVersion(terminalId: string): number {
  return bucketStates.get(terminalId)?.version ?? 0;
}

export function subscribeBucketUpdates(listener: BucketListener): () => void {
  bucketListeners.add(listener);
  return () => {
    bucketListeners.delete(listener);
  };
}
