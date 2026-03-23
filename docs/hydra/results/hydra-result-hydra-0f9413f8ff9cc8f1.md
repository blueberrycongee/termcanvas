Files changed and why
- `.hydra-result-hydra-0f9413f8ff9cc8f1.md`: recorded the PR review findings and verification evidence.

Issues found
1. `parseCodexSession()` can now emit negative `input` values when `cached_input_tokens > input_tokens` or `input_tokens` is missing while `cached_input_tokens` is present. In `electron/usage-collector.ts:372-380`, `input` is assigned as `inputTotal - cachedInput` with no clamp or validation. That feeds directly into `computeCost()`, `collectUsage()`, `collectHeatmapData()`, and sync, so one malformed or partial `token_count` event would produce negative input totals and negative cost. The new tests in `tests/usage-collector.test.ts:49-153` only cover happy-path subtraction and cumulative-last-event behavior; they do not cover the edge cases explicitly called out in the task.
2. This parser change alters the sync record hash for already-uploaded Codex sessions, so cloud sync will insert corrected duplicates instead of replacing the old incorrect rows. `mapUsageRecordToRow()` hashes `input_tokens`, `cache_read_tokens`, and `cost_usd` (`electron/usage-sync.ts:124-148`, `electron/usage-record-hash.ts:16-30`), and both backfill and incremental sync dedupe only on `(user_id, device_id, record_hash)` (`electron/usage-sync.ts:303-306`, `electron/usage-sync.ts:370-373`, `supabase/migrations/20260322230000_fix_usage_aggregation.sql:10-13`). After this fix, the same session produces a different hash, so existing cloud rows remain and corrected rows are added. The RPCs then sum both rows (`supabase/migrations/20260322230000_fix_usage_aggregation.sql:29-112`), so cloud totals and session counts can double-count for synced Codex history.
3. There is another Codex reader that still uses the old inclusive interpretation of `input_tokens`: `extractCodexSession()` in `electron/insights-engine.ts:674-695` stores `totalUsage.input_tokens` directly in `latestUsage.input`, and the insights aggregations/report treat that as "Input Tokens" (`electron/insights-engine.ts:783-787`, `electron/insights-shared.ts:909-918`, `electron/insights-shared.ts:1006-1015`, `electron/insights-report.ts:112-120`). So even if the usage cost panel is fixed, the insights report will still overstate Codex input tokens and daily token volume by including cached tokens in the input total.

What looks correct
- The pricing formula in `computeCost()` still makes sense once `input` is normalized to non-cached input and `cacheRead` carries `cached_input_tokens`. For well-formed Codex totals, the new local cost calculation is correct and local heatmap token totals remain stable because they sum `input + cacheRead + output`.
- `collectUsage()` and `collectHeatmapData()` consume the parsed fields consistently; they do not introduce a new double-count after the parser fix.

Whether tests pass
- `node --experimental-strip-types --test tests/usage-collector.test.ts` passed.
- `node --experimental-strip-types --test tests/usage-collector.test.ts tests/insights-engine.test.ts` was partially blocked by the sandbox: the usage collector tests passed, but an unrelated insights report test failed with `EPERM` while writing to `~/.termcanvas/insights-reports/...`.

Unresolved problems
- No fix in this PR for negative-input guarding in `parseCodexSession()`.
- No migration or overwrite strategy in this PR for already-synced cloud Codex rows whose hashes change after the correction.
- No corresponding normalization in the insights pipeline's direct Codex parser.
