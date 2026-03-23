# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Read-only design discussion for termcanvas. Focus: user expectations and UX habits in developer tools. Current state: DiffCard and FileTreeCard are hover-revealed anchored cards beside each worktree. Evaluate against how users expect navigation/change-review surfaces to behave in IDEs, code review tools, and agent-driven workflows. Recommend the best interaction model, note where termcanvas should intentionally differ from IDE conventions, and list the biggest usability risks. Do not edit files.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-9a8f66e10f7ccf8a.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
