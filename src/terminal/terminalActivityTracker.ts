// Per-terminal "last output" timestamps, used by the pan-to-recent-activity
// action. Lives outside the zustand store so a steady stream of PTY output
// doesn't trigger React re-renders — recall is read-on-demand at hotkey time.

const lastActivityAt = new Map<string, number>();

export function recordTerminalActivity(
  terminalId: string,
  now: number = Date.now(),
): void {
  lastActivityAt.set(terminalId, now);
}

export function clearTerminalActivity(terminalId: string): void {
  lastActivityAt.delete(terminalId);
}

export function clearAllTerminalActivity(): void {
  lastActivityAt.clear();
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
