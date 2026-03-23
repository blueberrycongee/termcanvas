# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Review the 'Generate Insights' feature in this repo in read-only mode. Independently verify whether each of these four suspected defects is real, partially valid, or not substantiated, based only on the current code and tests. Suspect 1: facet cache uses only session.id, so switching analysis CLI or re-running after session logs change can reuse stale/wrong facets. Suspect 2: facet extraction failures are silently dropped, so report generation can still succeed with inconsistent totals vs breakdowns. Suspect 3: narrative analysis uses only the first 30 facets without an intentional sampling strategy, causing sample bias while the report appears to represent all sessions. Suspect 4: the pipeline runs synchronous file scanning/parsing in the Electron main process and may block the app on large datasets. Inspect the relevant files, especially electron/insights-engine.ts, electron/insights-report.ts, electron/main.ts, src/components/usage/InsightsButton.tsx, and tests/insights-engine.test.ts. Output a concise review with one item per suspect: verdict, reasoning, and precise file/line references. Also mention any key assumptions or missing evidence. Do not modify files.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-f68fb944f5f64da7.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
