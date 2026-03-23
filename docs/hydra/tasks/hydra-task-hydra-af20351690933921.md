# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: feat/eval-framework

## Task

Audit electron/process-detector.ts for Windows vs macOS cross-platform issues. This file uses Unix-only 'ps -eo pid,ppid,args' command and splits paths with forward slash only. Read the full file and report: (1) exactly which functions will fail on Windows and why, (2) what Windows alternatives exist (tasklist, wmic, PowerShell Get-Process), (3) all hardcoded Unix assumptions. Be specific with line numbers.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-af20351690933921.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
