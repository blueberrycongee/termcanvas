Files changed and why

- `.hydra-result-hydra-142bdecff577fcbd.md`: Added the required review result record for this Hydra task.

Issues found

1. Low: `src/App.tsx:96-99` and `src/App.tsx:107-116` add a per-project sequence map (`latestSeqByPath`) and stale-result guard that never actually filters anything because `inFlight` already serializes rescans per project path. A second request cannot start until the first request's `.finally()` runs, so the `seq` check is always true for the active request. This is real state-machine overhead with no behavior benefit.

Reasonable complexity that is not a problem

- `electron/project-scanner.ts:78-88` doing `rev-parse --git-dir` before `listWorktreesAsync()` is reasonable. Without that pre-check, the fallback path in `listWorktreesAsync()` would fabricate a one-worktree result for non-git directories instead of preserving `scan()` semantics and returning `null`.
- `electron/project-scanner.ts:91-152` keeping both sync and async scanner methods is reasonable. `electron/main.ts` moved renderer IPC to async calls, but `electron/api-server.ts:214` still uses the synchronous scanner path.
- `src/stores/projectStore.ts:308-339` and `src/stores/projectStore.ts:425-440` short-circuiting `syncWorktrees()` when nothing changed is reasonable. It reduces unnecessary Zustand notifications and overlap recomputation rather than adding risky fallback behavior.

Whether tests pass

- Passed: `node --test tests/api-rescan.test.ts tests/project-store-sync-worktrees.test.ts`

Any unresolved problems

- None beyond the low-severity redundant sequence-tracking logic noted above.
