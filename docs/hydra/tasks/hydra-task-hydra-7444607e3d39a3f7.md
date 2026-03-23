# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: feat/eval-framework

## Task

Review this PR thoroughly: https://github.com/blueberrycongee/termcanvas/pull/30 — Read every file changed in the PR. Focus on: 1) Real bugs, logic errors, type safety issues 2) Whether the framework would actually work end-to-end 3) Missing edge cases that would cause runtime failures 4) Whether the CLI argument handling is correct 5) Whether the SWE-bench Docker integration would work in practice. Do NOT flag style issues or hypothetical improvements. Only report real problems. Write your findings to .hydra-result file.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-7444607e3d39a3f7.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
