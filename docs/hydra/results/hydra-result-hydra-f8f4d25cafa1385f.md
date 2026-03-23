Files changed and why
- `.hydra-result-hydra-f8f4d25cafa1385f.md`: captured the performance review findings and recommendations required by the task.

Issues found
- High: `project:diff` blocks the Electron main process with multiple synchronous git commands and synchronous per-file disk reads, including extra `git show` calls for binary images. This is the strongest match for beach-ball freezes during diff-heavy workflows. Evidence: `electron/main.ts:305-421`.
- High: quota fetching can block the main process for up to roughly 20 seconds because both macOS Keychain access and the Anthropic API call are executed with `execSync`. Evidence: `electron/quota-fetcher.ts:21-74`, invoked from `electron/main.ts:669-671`.
- High: worktree rescans are synchronous git calls and are triggered for every project on a fixed 5 second interval plus window-focus events. That creates recurring main-thread stalls proportional to project count. Evidence: `electron/project-scanner.ts:17-85`, `src/App.tsx:90-115`, `electron/main.ts:423-424`.
- Medium: `resolveOverlaps()` is wired into many store actions, including actions that do not change layout geometry, causing repeated whole-tree recomputation and object churn. Evidence: `src/stores/projectStore.ts:264-300`, call sites at `src/stores/projectStore.ts:307-339`, `352-446`, `471-494`, `570-621`.
- Medium: focus changes still deep-clone the full project/worktree/terminal tree on common interactions, so renderer cost is not limited to `resolveOverlaps()`. Evidence: `src/stores/projectStore.ts:646-709`.
- Medium: the HTTP API path duplicates the same synchronous diff logic as the IPC path, so fixing only `ipcMain.handle("project:diff")` will leave another blocking code path in place. Evidence: `electron/api-server.ts:349-420`.
- Low: state persistence remains fully synchronous and serializes full terminal scrollback snapshots before writing. This is probably not the primary beach-ball source, but it is another avoidable UI hitch path for large workspaces. Evidence: `src/snapshotState.ts:7-33`, `electron/state-persistence.ts:19-34`, `electron/main.ts:453-493`.
- Low: `GitFileWatcher.watch()` still does one synchronous `git rev-parse` on first subscription, but this is setup-time only and much smaller than the polling and diff paths. Evidence: `electron/git-watcher.ts:15-30`.

Priority recommendation
- I agree with the overall diagnosis and the priority ordering, with one adjustment: treat the duplicated API diff path as part of P0, not a follow-up. If the IPC path is fixed first but `/diff/...` still uses `execSync`, the app will retain a second freeze vector.
- Suggested ordering:
  - P0: async rewrite of both diff paths (`electron/main.ts` and `electron/api-server.ts`) plus async quota fetching
  - P1: async project scanning and reducing `resolveOverlaps()` call sites
  - P2: focus-state normalization/lift-out to remove O(N) cloning on focus changes
  - P3: async state persistence / snapshot throttling if freezes still appear with large saved scrollback

Answers
1. Do I agree with the diagnosis and priority ordering?
- Yes. The main-process `execSync` usage is the clearest root cause of AppKit beach balls because it blocks the Electron browser process event loop directly. Renderer inefficiency matters too, but it more often manifests as jank than the system-level spinning wait cursor.

2. Additional bottlenecks missed
- The duplicated synchronous diff implementation in `electron/api-server.ts`.
- Full-tree cloning on `setFocusedTerminal`, `setFocusedWorktree`, and `clearFocus`, even before any layout work.
- Synchronous state save/load with full scrollback serialization, especially if users keep many terminals with large buffers.
- Fixed-interval rescanning itself may be unnecessary load even after async conversion; event-driven invalidation plus backoff would reduce total work further.

3. `project:diff` async strategy
- Prefer `child_process.execFile` for the current migration, not `isomorphic-git`.
- Rationale:
  - You already depend on native `git` semantics such as `git diff HEAD`, `git diff --numstat`, `git ls-files`, and `git show HEAD:path`. Replacing that with `isomorphic-git` is higher-risk and likely to change behavior around config, attributes, renames, submodules, and worktrees.
  - `execFile` removes shell interpolation risk from `git show HEAD:${name}` and is the smallest safe refactor.
  - `spawn` is only worth the extra complexity if you need streaming progress or expect diffs larger than your acceptable buffer budget. For a request/response IPC handler, buffered `execFile` is the better default.
- Concretely:
  - Use `execFile("git", ["diff", "HEAD"], ...)`
  - Use `execFile("git", ["diff", "HEAD", "--numstat"], ...)`
  - Use `execFile("git", ["ls-files", "--others", "--exclude-standard"], ...)`
  - Use `execFile("git", ["show", `HEAD:${name}`], { encoding: "buffer" })` for image old blobs
- If very large diffs are common, switch only the full patch command to `spawn` and keep the metadata commands on `execFile`.

4. Migration concerns
- Do not convert to async but keep the same per-file fan-out unconstrained. `Promise.all` over many changed files can saturate disk and spawn too many git processes. Add bounded concurrency for per-file blob/content reads.
- Preserve cancellation semantics. Diff/quota requests should be ignorable if the requesting renderer state changes or the panel closes.
- Keep response ordering stable. The renderer likely expects deterministic file ordering from git output.
- Keep binary/image handling behavior explicit. Async conversion should not silently drop image previews or change the meaning of binary files.
- Avoid swallowing all failures into `{ diff: "", files: [] }`. That masks slow/failing subprocesses and makes regressions harder to diagnose. Return structured errors or at least log them.
- For quota fetching, prefer `execFile("/usr/bin/security", [...])` plus native `fetch` with `AbortSignal.timeout(...)`, instead of shelling out to `curl`.

Whether tests pass
- No tests were run. This task was a code review / performance audit only.

Unresolved problems
- I did not measure runtime traces or sample stacks, so the conclusions are code-structure based rather than profiler-quantified.
- If users report freezes during workspace save/open specifically, the synchronous snapshot/persistence path should be profiled next.
