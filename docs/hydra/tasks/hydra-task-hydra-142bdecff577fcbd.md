# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Review the current changes only in electron/project-scanner.ts, electron/main.ts, src/App.tsx, src/stores/projectStore.ts, src/stores/terminalState.ts, src/stores/preferencesStore.ts, tests/api-rescan.test.ts, tests/project-store-sync-worktrees.test.ts. Focus strictly on over-engineered fallbacks, unnecessary defensive branches, redundant compatibility layers, and unnecessary concurrency/state-machine complexity. Report only real issues, sorted by severity, with file:line references. Also explicitly call out anything that looks like fallback complexity but is actually reasonable and not a problem.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-142bdecff577fcbd.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
