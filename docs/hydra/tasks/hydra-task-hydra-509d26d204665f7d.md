# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: feat/eval-framework

## Task

Audit the UI/renderer layer for Windows vs macOS cross-platform issues: (1) src/components/ComposerBar.tsx - check Cmd vs Ctrl key handling for arrow keys and Ctrl+C, (2) src/terminal/TerminalTile.tsx - check Cmd+Backspace handling and whether Windows gets an equivalent, (3) src/hooks/useKeyboardShortcuts.ts and src/stores/shortcutStore.ts - check if all shortcuts work on both platforms, (4) electron-builder.yml - check Windows NSIS config completeness vs macOS DMG config. Read all files and report every Windows incompatibility with exact line numbers.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-509d26d204665f7d.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
