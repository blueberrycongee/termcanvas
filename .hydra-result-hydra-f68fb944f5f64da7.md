# Hydra Result: Insights Feature Defect Review

## Files changed and why
No files were modified (read-only review).

## Issues found

### Suspect 1: Facet cache uses only `session.id`, so switching CLI or re-running after session logs change can reuse stale/wrong facets

**Verdict: REAL**

**Reasoning:** The cache key is `sessionId` alone (the JSONL file's basename without extension). Two problems:

1. **Cross-CLI collision:** `readCachedFacet(session.id)` at `electron/insights-engine.ts:387` and `writeCachedFacet(session.id, facet)` at line 446 use a flat directory keyed only by `session.id`. If a Claude session and a Codex session happen to share the same basename (unlikely but possible with UUIDs, very possible if session IDs are sequential or user-controlled), the facet from one CLI would be served for the other. The `cli_tool` field is not part of the cache key.

2. **Stale data after session content changes:** Session JSONL files are append-only logs — new messages are appended as the session continues. `extractFacet` checks the cache at line 387 *before* any content comparison. There is no content hash, file mtime check, or file size check. If a user generates insights, then continues a session (adding messages), and generates insights again, the old facet is reused even though the session's `contentSummary`, `messageCount`, and `durationMinutes` have changed. The cache path is `FACET_CACHE_DIR/${sessionId}.json` (lines 240-244, 249).

**Files:** `electron/insights-engine.ts:240-268` (cache read/write), `electron/insights-engine.ts:387-388` (cache lookup in extractFacet).

---

### Suspect 2: Facet extraction failures are silently dropped, so report generation can still succeed with inconsistent totals vs breakdowns

**Verdict: REAL**

**Reasoning:** In the main pipeline at `electron/insights-engine.ts:689-694`:

```ts
const results = await Promise.all(
  batch.map((s) => extractFacet(s, cliSpec, cliTool)),
);
for (const r of results) {
  if ("session_id" in r) facets.push(r);
  // InsightsError results are silently discarded here
}
```

Failed extractions (returning `InsightsError`) are quietly skipped — no logging, no counter, no user notification. Then at line 714, `aggregateFacets(facets, sessions)` is called with `sessions` (ALL scanned sessions) but only successfully-extracted `facets`. The result:

- `stats.totalSessions` = `sessions.length` (all sessions, line 474)
- `stats.totalMessages` = sum over all sessions (line 475)
- `stats.totalDurationMinutes` = sum over all sessions (line 476)
- But all breakdown maps (outcome, session type, CLI, satisfaction, etc.) only count successfully extracted facets (lines 486-502)

This means the report header shows e.g. "200 sessions analyzed" while breakdown percentages only sum to e.g. 150. The discrepancy is invisible to the user. The only guard is that if *all* facets fail, the pipeline returns an error (line 697-705), but partial failures are hidden.

**Files:** `electron/insights-engine.ts:689-694` (silent drop), `electron/insights-engine.ts:469-505` (aggregation mismatch).

---

### Suspect 3: Narrative analysis uses only the first 30 facets without intentional sampling strategy, causing sample bias

**Verdict: REAL**

**Reasoning:** At `electron/insights-engine.ts:532`:

```ts
const sampleFacets = facets.slice(0, 30);
```

This takes the *first* 30 facets. The order of `facets` is determined by iteration order over `sessions`, which comes from `scanAllSessions()` (line 671). That function iterates Claude files first, then Codex files (lines 178-188), both in filesystem enumeration order (directory listing order from `findClaudeJsonlFiles`/`findCodexJsonlFiles` — see `usage-collector.ts:180-219`). There is no sorting, shuffling, or stratified sampling.

Consequences:
- If a user has >30 sessions, the sample is biased toward whichever CLI tool's files appear first in directory listing order (typically Claude since it's iterated first).
- Recent sessions may be excluded entirely if they sort late in the filesystem listing.
- The prompt sent to the LLM says `Sample session facets (30 of N)` (line 537), so the LLM *knows* it's a sample — but the final report presents the analysis as comprehensive without noting sampling limitations.
- The aggregated `stats` object *does* include all facets (line 714), so statistical breakdowns are complete. But the narrative analysis sections (project areas, interaction style, friction analysis, etc.) are generated from only 30 facets, potentially misrepresenting the user's actual patterns.

**Files:** `electron/insights-engine.ts:532` (slice), `electron/insights-engine.ts:175-189` (scan order), `electron/insights-engine.ts:537` (sample note in prompt).

---

### Suspect 4: Pipeline runs synchronous file scanning/parsing in the Electron main process and may block the app on large datasets

**Verdict: REAL**

**Reasoning:** The IPC handler at `electron/main.ts:660-667` calls `generateInsights()` directly in the main process:

```ts
ipcMain.handle("insights:generate", async (_event, cliTool) => {
  const { generateInsights } = await import("./insights-engine");
  return generateInsights(cliTool, (progress) => { ... });
});
```

Inside `generateInsights`, `scanAllSessions()` (line 671) calls `findClaudeJsonlFiles()` and `findCodexJsonlFiles()`, which use synchronous fs APIs:
- `fs.existsSync()` (usage-collector.ts:185, 204)
- `fs.readdirSync()` (usage-collector.ts:191, 206-218)
- Then `extractClaudeSession`/`extractCodexSession` use `fs.readFileSync()` (insights-engine.ts:42, 108) to read and parse entire JSONL files, splitting and JSON.parse-ing every line.

All of this runs on the main process event loop with no `setImmediate` yielding (unlike the heatmap/cloud endpoints in usage-collector.ts which *do* batch with `setImmediate`). For a user with hundreds of session files (common for active Claude users), this could block the main process for seconds, freezing the UI.

The CLI invocations (`invokeCli` via `execFile`) are async and non-blocking (child processes), but the file scanning and session extraction phase is fully synchronous. The `aggregateFacets` call is also synchronous but operates on in-memory data so it's fast.

**Files:** `electron/main.ts:660-667` (main-process handler), `electron/insights-engine.ts:42,108` (readFileSync), `electron/insights-engine.ts:175-189` (scanAllSessions), `electron/usage-collector.ts:180-219` (sync directory traversal).

---

## Whether tests pass

The existing tests (`tests/insights-engine.test.ts`) only cover `buildCliInvocationArgs` — they do not test the cache, aggregation, sampling, or pipeline integration. None of the four defects are covered by tests.

## Unresolved problems

All four suspects are substantiated. Key assumptions:
- **Suspect 1:** Assumes session IDs could collide across CLIs; even without collision, stale data from continued sessions is the more likely real-world issue.
- **Suspect 4:** Severity depends on dataset size. For <50 sessions the blocking is negligible; for hundreds it becomes noticeable.

No files were modified per the read-only constraint.
