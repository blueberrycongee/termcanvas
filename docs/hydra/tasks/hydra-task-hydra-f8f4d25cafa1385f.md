# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Review this Electron terminal app's performance bottlenecks. We found the app frequently freezes (macOS spinning beach ball). The main causes we identified are:

1. **project:diff IPC handler** (electron/main.ts:305-421): chains 3+ execSync git commands + loops over changed files with more execSync/readFileSync calls, all blocking the main Electron process
2. **quota-fetcher.ts**: uses execSync for both macOS keychain access (5s timeout) and curl to Anthropic API (15s timeout), completely blocking main process
3. **project-scanner.ts**: uses execSync for git commands, called every 5 seconds via polling for all projects
4. **Renderer side**: resolveOverlaps() with expensive packTerminals() bin-packing called on 11+ store actions including non-layout ones like focus changes

Our proposed fix priority:
- P0: Convert project:diff and quota-fetcher from execSync to async (execFile/fetch)
- P1: Convert project-scanner to async, reduce resolveOverlaps calls
- P2: Lift focus model out of the project tree to avoid O(N) cloning

Questions for you:
1. Do you agree with this diagnosis and priority ordering?
2. Any additional bottlenecks we might have missed?
3. For the async conversion of project:diff, should we use child_process.execFile, spawn with streaming, or a git library like isomorphic-git?
4. Any concerns about the migration approach?

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-f8f4d25cafa1385f.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
