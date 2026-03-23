Files changed and why
- `.hydra-result-hydra-90b95e9912ab6e0f.md`: analysis-only task result artifact required by the Hydra task instructions.

Issues found
- Main-process blocking in `electron/main.ts` `project:diff`: synchronous `git diff`, `git diff --numstat`, `git ls-files`, per-file `git show`, and `fs.readFileSync`/`fs.openSync`.
- Main-process blocking in `electron/quota-fetcher.ts`: synchronous macOS Keychain lookup and synchronous `curl`, both reached from the `quota:fetch` IPC handler in `electron/main.ts`.
- Main-process blocking in `electron/project-scanner.ts`: synchronous Git commands used by both the IPC scan path and the API server rescan path.
- Main-process blocking in `electron/api-server.ts` `getDiff`: duplicated synchronous diff logic on the same Electron main-process event loop.
- Renderer layout churn in `src/stores/projectStore.ts`: `resolveOverlaps()` runs on many actions, including worktree sync and terminal span/type changes.
- Renderer focus churn in `src/stores/projectStore.ts`: `setFocusedTerminal`, `setFocusedWorktree`, and `clearFocus` rebuild the entire project/worktree/terminal tree and rewrite every terminal's `focused` flag.

Whether tests pass
- No tests were run. This task was analysis-only and made no behavioral code changes.

Unresolved problems
- The performance recommendations were delivered inline to the user rather than implemented in code.
- Existing unrelated untracked files were present in the worktree and were intentionally left untouched.
