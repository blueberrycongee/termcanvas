# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

You are reviewing the termcanvas codebase to analyze a planned feature: adding a setting to disable the composer bar. When disabled, focusing a terminal should put the cursor directly in the xterm terminal instance instead of the composer textarea.

Your job is to thoroughly review the codebase and identify ALL edge cases, affected scenarios, and potential issues. Do NOT write any code. Just analyze and report.

Key files to review:
- src/stores/composerStore.ts - composer state
- src/components/ComposerBar.tsx - composer UI and input routing
- src/components/composerTarget.ts - target resolution
- src/terminal/TerminalTile.tsx - terminal rendering and xterm instance
- src/stores/projectStore.ts - focus state management
- src/hooks/useKeyboardShortcuts.ts - keyboard shortcuts
- src/stores/preferencesStore.ts - settings
- src/components/SettingsModal.tsx - settings UI
- src/terminal/cliConfig.ts - per-terminal-type config

Please analyze and report on:
1. All places where composer existence is assumed (layout, focus, input routing)
2. Edge cases when composer is hidden (e.g., what happens to image paste? rename mode? error display?)
3. Keyboard shortcut conflicts - which shortcuts currently go through composer that would need to work differently
4. Focus lifecycle - what happens on terminal create, close, switch when composer is gone
5. Any race conditions or state inconsistencies that could arise
6. Layout impact - what components depend on composer bar height
7. Terminal types that rely on composer features (bracketed-paste, image support)
8. The interaction between composer disabled and features like terminal rename (Cmd+;)

Write your findings to a structured report.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-71d994e372b5b0df.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
