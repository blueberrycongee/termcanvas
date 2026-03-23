# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Independently analyze GitHub issue #99 in this repo: theme switch leaves some CLI input boxes in the previous theme. Inspect the local codebase only, do not trust the parent agent's conclusion by default. Determine the most likely root cause, list the concrete code paths that support your conclusion, explicitly say whether you agree or disagree with this hypothesis: 'theme changes only update xterm renderer state, but some CLI input boxes are self-rendered truecolor/TUI UI and are not notified of runtime theme changes'. This is an analysis-only task; do not make code changes other than the required Hydra result file.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-5bf7c1cc781e5ad5.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
