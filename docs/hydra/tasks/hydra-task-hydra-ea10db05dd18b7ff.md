# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Review the git history of scroll-pinning fixes in this terminal emulator project. There have been at least 4 attempts to fix the 'terminal doesn't follow output during Claude CLI streaming' bug:

1. Commit 9fd6689: used xterm.onScroll as single source of truth for follow-bottom
2. Commit 9a75fd7: switched to viewport DOM scroll event for follow-bottom tracking
3. Commit a32faa2: fixed programmaticScrollCount guard to allow user scroll-up during streaming
4. Commit 18fd0dc (latest): replaced scroll-event-based approach entirely with user input event tracking (wheel/keydown)

Your task:
- Read each commit's diff carefully (use git show <hash>)
- Analyze the evolution of approaches: what each one tried, why it failed
- Evaluate the latest fix (18fd0dc): is it fundamentally different from the previous 3? Does it address the root cause?
- Identify any remaining edge cases or potential issues with the new approach
- Write a clear, critical analysis in Chinese (中文). Be honest — if the new approach still has the same category of problem, say so.

Focus on src/terminal/TerminalTile.tsx

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-ea10db05dd18b7ff.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
