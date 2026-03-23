Files changed and why
- `electron/git-diff.ts`: extracted the synchronous git diff logic into a shared async module using promisified `child_process.execFile`, `fs/promises`, and a concurrency limit of 5 for per-file work while preserving each caller's existing behavior.
- `electron/main.ts`: replaced the inline synchronous `project:diff` IPC implementation with the shared async module call, keeping the same `{ diff, files }` fallback on error.
- `electron/api-server.ts`: replaced the inline synchronous `/diff/...` implementation with the shared async module call, keeping the same wrapped 400 error behavior and response shapes.
- `tests/git-diff.test.ts`: added regression coverage for the IPC diff path and both API diff modes against real temporary git repositories.
- `package.json`: included the new regression test in `npm test` so the required verification command exercises this change.

Issues found
- The referenced plan file `docs/plans/2026-03-23-p0-async-perf.md` was not present in this worktree or git history, so implementation followed the task file plus the in-repo async-perf review notes that described the intended Task 1 constraints.

Whether tests pass
- Yes. `npm test` passed with 128/128 tests passing.
- Yes. `npm run typecheck` passed.

Unresolved problems
- None in scope for this task.
