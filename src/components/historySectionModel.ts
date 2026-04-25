export function shouldRefreshHistorySection(
  projectDirs: string[],
  changedProjectDirs: string[],
): boolean {
  if (projectDirs.length === 0 || changedProjectDirs.length === 0) {
    return false;
  }

  const scope = new Set(projectDirs.map((dir) => dir.trim()).filter(Boolean));
  if (scope.size === 0) {
    return false;
  }

  return changedProjectDirs.some((dir) => scope.has(dir.trim()));
}

export interface GroupableHistoryEntry {
  sessionId: string;
  projectDir: string;
  lastActivityAt: string;
}

export interface HistoryProjectGroup<T extends GroupableHistoryEntry> {
  projectDir: string;
  entries: T[];
  /** Most-recent activity within the group, used to sort groups. */
  latestActivityAt: string;
}

/**
 * Group history entries by `projectDir`, ordering groups by the most
 * recent activity in each group and entries within a group newest-
 * first. Stable for entries with identical timestamps so paginated
 * loads don't visibly reshuffle on refresh.
 *
 * Grouping is intentionally client-side: it shares the existing
 * `listSessionsPage` IPC and avoids a per-project fetch storm. The
 * tradeoff is that a paginated tail can land mid-group — the user
 * sees "Project A (3 of 12)" and clicks "Load more" to fill it in —
 * which is acceptable because the server already sorts by mtime, so
 * the rows that appear first ARE the ones the user is likely to
 * recognize.
 */
export function groupHistoryByProject<T extends GroupableHistoryEntry>(
  entries: T[],
): HistoryProjectGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const entry of entries) {
    const bucket = buckets.get(entry.projectDir);
    if (bucket) bucket.push(entry);
    else buckets.set(entry.projectDir, [entry]);
  }

  const groups: HistoryProjectGroup<T>[] = [];
  for (const [projectDir, bucketEntries] of buckets) {
    bucketEntries.sort((a, b) => {
      const at = new Date(a.lastActivityAt).getTime();
      const bt = new Date(b.lastActivityAt).getTime();
      return bt - at;
    });
    groups.push({
      projectDir,
      entries: bucketEntries,
      latestActivityAt: bucketEntries[0]?.lastActivityAt ?? "",
    });
  }
  groups.sort((a, b) => {
    const at = new Date(a.latestActivityAt).getTime();
    const bt = new Date(b.latestActivityAt).getTime();
    return bt - at;
  });
  return groups;
}

/**
 * Filter out entries whose sessionId is in `hidden`. Pure helper so
 * the grouping → filtering pipeline is unit-testable without a DOM.
 */
export function filterHiddenEntries<T extends GroupableHistoryEntry>(
  entries: T[],
  hidden: ReadonlySet<string>,
): T[] {
  if (hidden.size === 0) return entries;
  return entries.filter((entry) => !hidden.has(entry.sessionId));
}
