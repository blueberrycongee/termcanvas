## Files changed and why

- `.hydra-result-hydra-5516cc21557a368c.md`: Recorded the investigation results for the Codex usage accounting bug.

## Issues found

- Real bug: `electron/usage-collector.ts` treats Codex `total_token_usage.input_tokens` and `cached_input_tokens` as independent additive buckets, but the session JSONL data shows `cached_input_tokens` is a subset of `input_tokens`.
- Evidence from real session files:
  - Across all `token_count` events scanned under `~/.codex/sessions` (26,815 events), 26,814 satisfy `total_tokens == input_tokens + output_tokens` exactly.
  - Across final per-session totals (the same shape `parseCodexSession()` uses), 2,681 of 2,682 sessions satisfy `total_tokens == input_tokens + output_tokens` exactly. The lone outlier is a malformed zero-token record with `total_tokens = 258400`, so it does not affect the cache-overlap conclusion.
  - `input_tokens` is always greater than or equal to `cached_input_tokens` in the final per-session records; 2,681 of 2,682 sessions have `cached_input_tokens > 0`.
  - Representative final session:
    - File: `~/.codex/sessions/2026/03/03/rollout-2026-03-03T12-13-59-019cb1e7-1c7b-7be1-90c4-5b4b49fb6f9e.jsonl`
    - `input_tokens = 50,230,285`
    - `cached_input_tokens = 48,135,168`
    - `output_tokens = 185,511`
    - `total_tokens = 50,415,796`
    - `input_tokens + output_tokens = 50,415,796`
    - `input_tokens + cached_input_tokens + output_tokens = 98,550,964` (clearly not what `total_tokens` reports)
- Why `computeCost()` inflates cost:
  - Current formula charges:
    - `input * input_rate`
    - `cacheRead * cache_read_rate`
  - If `cacheRead` is already inside `input`, cached tokens are billed twice: once at full input price and again at cache-read price.
  - The inflation amount is exactly `cached_input_tokens * input_rate`.
- Quantified inflation using the current Codex pricing in `electron/usage-collector.ts` (`$1.50/M input`, `$0.375/M cache_read`, `$6.00/M output`), evaluated over the final record from every session:
  - Sessions scanned: 2,682
  - Current collector cost: `$2252.5609365`
  - Corrected cost if cached tokens are removed from the full-price input bucket: `$651.0839445`
  - Inflation: `$1601.476992`
  - Inflation vs corrected cost: `245.97%`
  - Extra tokens counted in token totals/heatmap due to additive `input + output + cacheRead`: `1,067,651,328`
- Representative session cost inflation for the same file above:
  - Current collector cost: `$94.5091815`
  - Corrected cost: `$22.3064295`
  - Inflation: `$72.202752`

## Whether tests pass

- No project tests were run. This task was an investigation only.
- Verification performed manually by scanning the real `~/.codex/sessions` JSONL corpus and comparing those numbers to the formulas in `electron/usage-collector.ts`.

## Unresolved problems

- There is one anomalous final session record with `input_tokens = 0`, `output_tokens = 0`, `cached_input_tokens = 0`, `total_tokens = 258400`. It appears unrelated to the cache-overlap question, but it may deserve separate defensive handling if the collector later relies on `total_tokens`.
