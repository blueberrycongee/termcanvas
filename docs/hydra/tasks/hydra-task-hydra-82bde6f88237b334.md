# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

Scan the TermCanvas codebase for user-facing bugs and UX issues. Focus ONLY on things that would visibly affect the user experience. DO NOT report code style issues, theoretical concerns, or non-issues.

Check these areas:
1. UI components in src/components/ - look for overflow issues, missing error states, broken interactions, accessibility problems
2. Electron main process in electron/ - look for race conditions, unhandled errors, missing IPC handlers
3. State management in src/stores/ - look for state that doesn't persist when it should, or persists when it shouldn't
4. Canvas save/restore logic - look for data that might be lost during save/restore cycles
5. Terminal management - look for edge cases in terminal creation, resize, focus, or cleanup
6. Settings/preferences - look for settings that don't apply correctly or have broken UI
7. Composer/input handling - look for input bugs, paste issues, submission edge cases
8. Auto-updater - look for update flow issues
9. i18n - look for missing translations or hardcoded strings that should be translated

For each issue found, report:
- File and line number
- What the user would experience
- Severity (high/medium/low)

Do NOT:
- Report code quality or style issues
- Report hypothetical issues that require unlikely conditions
- Report issues already tracked in GitHub issues #13-#20
- Suggest improvements or enhancements
- Fix anything - this is read-only investigation

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-82bde6f88237b334.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
