# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: feat/eval-framework

## Task

Audit these files for Windows vs macOS cross-platform issues: (1) electron/hydra-skill.ts - check symlink usage and whether it needs admin privileges on Windows, (2) electron/session-watcher.ts - check path regex at line 91, (3) electron/insights-engine.ts - check SIGTERM usage and any Unix-only commands, (4) electron/auto-updater.ts and electron/mac-updater.ts - compare Windows vs macOS update paths. Read all files and report every Windows incompatibility with exact line numbers.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-4a6b54ae825b8097.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
