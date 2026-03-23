# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: feat/eval-framework

## Task

Audit electron/main.ts for Windows vs macOS cross-platform issues. Focus on: (1) the unzip commands around line 753-768 - will they work on Windows? (2) CLI registration functions registerCli/unregisterCli/isCliRegistered around lines 850-975 - is Windows implemented? (3) the pkill error message at line 43, (4) any other platform-specific code. Read the full file and report every Windows incompatibility with exact line numbers.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-b69830afe612b1f6.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
