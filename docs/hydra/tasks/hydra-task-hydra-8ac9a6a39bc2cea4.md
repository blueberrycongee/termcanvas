# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Read-only design discussion for termcanvas. Focus: product philosophy. Current state: WorktreeContainer shows DiffCard and FileTreeCard as hover-revealed anchored side cards for each worktree, with optional pinning. Question: from termcanvas's infinite-canvas and multi-agent workspace philosophy, should file tree and diff remain accessory hover cards, become integrated panes, or become independent first-class canvas objects? Give 1 recommended direction, why it fits the product, what anti-pattern to avoid, and 2-3 concrete UX principles. Do not edit files.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-8ac9a6a39bc2cea4.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
