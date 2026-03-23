# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Investigate bugs in TermCanvas insights feature. Read the following files and analyze the issues:

FILES TO READ:
1. electron/insights-engine.ts - Core pipeline
2. electron/insights-report.ts - HTML report generation
3. electron/insights-shared.ts - Types and parsing
4. electron/insights-cli.ts - CLI invocation

KNOWN BUGS TO ANALYZE:
1. TIME OF DAY HEATMAP: All hours show 0 messages except 22:00 and 23:00. The aggregateFacets() function in insights-shared.ts filters sessions by facet ID, causing data loss for sessions without matching facets. Find the exact bug and propose a fix.

2. SECTION REPETITION: All 7 AI analysis rounds receive identical data context from buildAnalysisDataContext(). The same stats (5 fully achieved, 3 mostly, 3 partially; 13 tool failures, 12 retries) repeat in every section. Find where the data context is built and passed, and propose how to differentiate each round.

3. SATISFACTION ALWAYS UNCLEAR: The facet extraction prompt asks for user_satisfaction but provides no guidance on how to determine it from metrics. Find the prompt and propose improvements.

4. SCANNED VS ANALYZED COUNT MISLEADING: Report shows 11 analyzed / 1640 scanned which is confusing. Find the counting logic and propose clearer reporting.

For each bug: identify the exact code location (file:line), explain the root cause, and write a concrete fix proposal with code snippets. Output your findings as a structured report.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-9a42bc1c1c7532fe.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
