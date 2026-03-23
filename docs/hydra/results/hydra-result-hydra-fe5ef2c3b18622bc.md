Files changed and why
- `electron/quota-fetcher.ts`: replaced blocking `execSync` calls with async `execFile` for macOS Keychain access and native `fetch` plus `AbortSignal.timeout` for the Anthropic usage request, while preserving the existing return shapes and catch-all error behavior.

Issues found
- The task referenced `docs/plans/2026-03-23-p0-async-perf.md`, but that file was not present anywhere in this worktree or its parent checkout. I used the task brief plus the existing quota implementation context to keep the change scoped correctly.

Whether tests pass
- `npm test`: pass
- `npm run typecheck`: pass

Any unresolved problems
- None in the implemented scope.
