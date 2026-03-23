# Hydra Sub-Agent Task

You are working in an isolated git worktree.

- Worktree: /Users/zzzz/termcanvas
- Branch: (existing worktree)
- Base branch: main

## Task

You are reviewing a design proposal for refactoring the save mechanism in TermCanvas, an Electron-based terminal canvas application. Please read the task file carefully for full context, then analyze the design critically. Focus on:

1. Is the dirty tracking approach sound? Should we compare serialized snapshots or use event-based dirty marking?
2. Any concerns with the 60-second auto-save interval?
3. Is the 2-second SIGTERM→SIGKILL timeout appropriate for AI CLI processes (Claude Code, Codex)?
4. Are there edge cases in the close flow we're missing?
5. Should auto-save write to state.json only, or also to the workspace file?
6. Any other improvements or concerns?

Background: TermCanvas manages multiple AI CLI sessions (Claude Code, Codex, Kimi, etc.) in a visual canvas. When users save and restart, sessions cannot be restored because: (a) no auto-save, (b) Save button is actually Save-As with file picker, (c) PTY processes killed with SIGHUP giving no time to save session data.

Current architecture:
- State saved to ~/.termcanvas/state.json (auto-restore)
- Workspace files (.termcanvas) saved/loaded via file dialogs
- Session IDs captured by polling ~/.claude/sessions/{pid}.json
- On restore: claude --resume {sessionId} or codex resume {sessionId}
- PTY kill() sends SIGHUP, no graceful shutdown
- Key files: src/App.tsx, src/stores/canvasStore.ts, electron/pty-manager.ts, electron/main.ts

Proposed design:
1. Document Model: Add workspacePath (string|null) and dirty (boolean) to canvasStore. Title bar shows doc name with * when dirty.
2. Save Semantics (Photoshop model): Cmd+S = save to current file (or file picker if new); Cmd+Shift+S = always file picker (Save As); Auto-save every 60s to state.json; Close when dirty shows Save/Don't Save/Cancel dialog.
3. Graceful PTY Shutdown: SIGTERM → wait 2s → SIGKILL for all PTY processes.
4. Files to change: canvasStore.ts, shortcutStore.ts, useKeyboardShortcuts.ts, App.tsx, pty-manager.ts, main.ts, preload.ts, i18n/*.ts

Please provide specific, actionable feedback. Point out any flaws, missing edge cases, or improvements. Read the relevant source files to ground your review in the actual codebase.

## Rules

- Stay within this worktree. Do not modify files outside it.
- Commit your changes before finishing.
- Do not push to remote.
- Before finishing, write `.hydra-result-hydra-a3853d2ab0d736b1.md` in the worktree root with:
  - Files changed and why
  - Issues found (if audit/review task)
  - Whether tests pass
  - Any unresolved problems
