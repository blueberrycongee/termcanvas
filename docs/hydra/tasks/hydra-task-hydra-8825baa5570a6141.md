# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Read-only design discussion for termcanvas. Focus: migration path from current implementation. Current state lives mainly in src/containers/WorktreeContainer.tsx with DiffCard/FileTreeCard/FileCard as anchored floating cards and hover/pin logic. Recommend the most plausible next interaction model that improves workflow without requiring a ground-up rewrite. Compare 2-3 migration options by implementation leverage, behavior continuity, and future extensibility. Do not edit files.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-8825baa5570a6141.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
