# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Review a one-line fix to UsagePanel.tsx and answer two questions.

## The fix (already applied)

In src/components/UsagePanel.tsx, the 60-second polling interval was changed from:

```ts
const interval = setInterval(() => {
  void fetchUsage();
  if (isLoggedIn) void fetchCloud();
}, 60_000);
```

to:

```ts
const interval = setInterval(() => {
  void fetchUsage();
  if (isLoggedIn) {
    void fetchCloud();
    void fetchCloudHeatmap();
  }
}, 60_000);
```

## Context

The bug: cloudHeatmapData in the zustand store stays null because:
1. On app startup, auth is still restoring when UsagePanel mounts, so isLoggedIn is false and fetchCloudHeatmap() is skipped
2. When isLoggedIn becomes true, the effect re-fires and calls fetchCloudHeatmap(), but it may fail due to main-process auth timing
3. The 60s polling interval did NOT include fetchCloudHeatmap, so it never retries
4. Result: monthly total and heatmap only show local (single-device) data instead of cloud-aggregated data

The cloud heatmap IPC call (window.termcanvas.usage.heatmapCloud -> usage-sync.ts queryCloudHeatmap) works correctly when called manually from DevTools console. The cloud data IS complete in Supabase (verified: .88 March total across 2 devices, but UI shows  = local only).

## Questions to answer

1. Do you agree this fix is correct and sufficient? Are there any edge cases or concerns? Consider:
   - fetchCloudHeatmap has a 5-minute stale check (CLOUD_HEATMAP_STALE_MS = 5 * 60_000), so polling every 60s won't cause excessive requests
   - Is there a better fix (e.g., fixing the root timing issue instead of adding polling)?
   - Should we also add fetchCloudHeatmap to the prefetch timer or the mount effect? (it's already in both, the issue is the retry path)

2. After bumping a new version and users open the app, will the heatmap display correct aggregated data immediately? Consider:
   - The cloud data is already complete in Supabase
   - The fix ensures fetchCloudHeatmap is retried every 60s
   - On fresh app open, the mount effect fires fetchCloudHeatmap (line 526), which should work if auth is ready
   - The 1200ms prefetch timer also fires fetchCloudHeatmap
   - Is there still a window where the user sees stale/local-only data before the cloud fetch completes?

Be critical. If the fix is insufficient, explain exactly what else is needed.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-0b5c2f3e26e5c0a5.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
