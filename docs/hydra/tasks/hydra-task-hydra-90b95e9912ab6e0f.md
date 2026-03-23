# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

We are discussing performance optimization for this Electron terminal app. The app frequently freezes with the macOS spinning beach ball.

## Diagnosis so far (agreed upon)

### Main process blocking (root cause of beach ball):
1. **project:diff IPC handler** (electron/main.ts:305-421): chains 3+ execSync git commands + per-file execSync/readFileSync loops
2. **quota-fetcher.ts**: execSync for macOS keychain (5s timeout) + execSync curl to API (15s timeout)
3. **project-scanner.ts**: execSync git commands, called every 5s via polling for all projects
4. **api-server.ts**: duplicated synchronous diff logic (same as IPC path)

### Renderer side:
5. resolveOverlaps() called on 11+ store actions including non-layout ones, each running packTerminals() bin-packing
6. Focus changes deep-clone entire project/worktree/terminal tree

## Proposed priority:
- P0: async rewrite of diff paths (IPC + API server) + quota-fetcher
- P1: async project-scanner + reduce resolveOverlaps calls
- P2: lift focus model out of tree

## Questions I want your opinion on:

1. **git diff streaming vs buffering**: For `git diff HEAD` with 10MB maxBuffer, should we use spawn with streaming instead of execFile? The numstat/ls-files calls are small, but the full patch can be huge. What's the tradeoff?

2. **api-server.ts diff priority**: The API server diff path is only used by Hydra agents, not user-facing diff cards. Should it really be P0, or is it P1 since it only affects automated agents and won't cause user-visible beach balls?

3. **Renderer impact after async fix**: Once execSync is gone, resolveOverlaps becomes the next bottleneck. With 5 projects * 3 worktrees * 5 terminals = 75 terminals re-laid-out on every status change. Should we elevate resolveOverlaps reduction above project-scanner async?

4. **Polling vs event-driven**: Even after async project-scanner, polling every 5s is wasteful. GitFileWatcher already uses chokidar. Should we replace polling with fs.watch on .git/worktrees/ directory? What are reliability tradeoffs?

5. **Concurrency limit**: For async fan-out of per-file git show / file reads in the diff handler, what concurrency limit would you recommend and why?

Please read the relevant source files before answering. Give specific, reasoned opinions on each point.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-90b95e9912ab6e0f.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
