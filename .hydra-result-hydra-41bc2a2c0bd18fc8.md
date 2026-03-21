Files changed and why
- `.hydra-result-hydra-41bc2a2c0bd18fc8.md`: added the requested read-only audit report.

Issues found
- Medium: `src/stores/projectStore.ts:578`
  Renaming a terminal marker updates the in-memory store but never marks the workspace dirty. The rename appears immediately, but the window does not show unsaved state and recovery autosave will not run until some unrelated change happens, so a crash can lose the rename.
- Medium: `electron/main.ts:479`, `src/App.tsx:130`, `src/App.tsx:204`
  Opening an existing `.termcanvas` file or restoring autosaved state clears the workspace path. After that, `Save` behaves like `Save As` instead of overwriting the original workspace file.
- Low: `src/App.tsx:42`
  Workspace restore drops terminal metadata such as `origin`, `initialPrompt`, and `autoApprove`. Saved agent terminals come back looking like regular terminals, and some launch metadata is lost across save/restore.
- Medium: `src/App.tsx:93`
  Worktree rescans are tied only to `projects.length`. If the user opens or switches to another workspace with the same project count, the polling/focus watcher keeps scanning the old repo list, so worktree lists in the new workspace stop syncing.
- Medium: `src/components/ComposerBar.tsx:382`
  Dragging non-image files into the composer inserts raw absolute paths joined with spaces and no escaping. File names that contain spaces are pasted as broken paths.
- Medium: `src/stores/themeStore.ts:11`
  Theme choice never persists. Switching to light mode works for the current session only and resets to dark on the next launch.
- Medium: `src/components/SettingsModal.tsx:361`
  Terminal font size only commits on mouse/touch release. Keyboard users can move the slider, but the actual preference does not apply or save.
- Low: `src/components/UpdateModal.tsx:17`, `electron/auto-updater.ts:65`, `electron/mac-updater.ts:271`
  Retrying an update check can leave the updater UI stuck in `checking` when no update is available, because the frontend only handles available/downloaded/error events and never gets a no-update state back.
- Low: `src/components/UpdateModal.tsx:45`
  The update modal is hardcoded in English. Chinese locale users still see strings like `Update Ready`, `Retry`, and `Restart & Update`.
- Low: `src/canvas/Canvas.tsx:87`
  The empty-canvas onboarding text is hardcoded in English. Chinese locale users still see `No projects yet` and `Add Project`.

Whether tests pass
- Not run. This was a read-only investigation.

Any unresolved problems
- None beyond the findings above.
