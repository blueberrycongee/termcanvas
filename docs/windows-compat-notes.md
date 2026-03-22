# Windows Compatibility Notes

Known cross-platform differences that are not confirmed bugs but may need
attention if full Windows support is a goal. High-confidence bugs are tracked
as GitHub issues (#31–#37).

---

## Design-level: Ctrl shortcut conflicts with terminal

On macOS, app shortcuts use `Cmd+…` so they never collide with terminal
`Ctrl+…` signals (Ctrl+C, Ctrl+D, etc.). On Windows, `mod` maps to `Ctrl`,
meaning app shortcuts like Ctrl+N (new terminal), Ctrl+S (save), Ctrl+P
(previous terminal) overlap with terminal control sequences when xterm is
focused. This is an architectural question—options include:

- Scope app shortcuts to non-terminal contexts on Windows.
- Use `Alt+…` as the Windows app modifier.
- Let xterm swallow Ctrl when focused and only expose app shortcuts via menu.

**Files:** `shortcutStore.ts:26-43`, `useKeyboardShortcuts.ts`, `shortcutTarget.ts:13-17`, `TerminalTile.tsx:332-344`

---

## TerminalTile: no Windows equivalent for Cmd+Backspace (kill line)

macOS maps Cmd+Backspace → Ctrl+U (delete to line start). Windows has no
equivalent binding. Ctrl+Backspace typically deletes a word, not a line.
Consider binding Ctrl+U directly on Windows, though this conflicts with the
shortcut architecture issue above.

**File:** `TerminalTile.tsx:334-345`

---

## insights-engine: POSIX path regex misses Windows paths

Line 185 uses `/[\w./~-]+\.[a-z0-9]+/gi` to extract file references from
command text. Backslash paths (`C:\src\main.ts`) and drive letters are not
matched. Windows commands are undercounted in the insights analysis.

**File:** `insights-engine.ts:185`

---

## insights-engine: Claude project path decoding assumes Unix encoding

Lines 351–353 reconstruct project paths by replacing `-` with `/`. This
matches the macOS/Linux encoding where `/Users/foo/project` becomes
`-Users-foo-project`. Windows paths like `C:\Users\foo\project` encode
differently and will not decode back to a valid path.

**File:** `insights-engine.ts:351-353`

---

## insights-engine: SIGTERM semantics differ on Windows

Line 1005 uses `child.kill("SIGTERM")`. Node.js accepts this on Windows but
maps it to `TerminateProcess`, which is an abrupt kill rather than a graceful
signal. The process gets no chance to clean up.

**File:** `insights-engine.ts:1005`

---

## electron-builder: NSIS config is minimal

The Windows NSIS installer block only sets `oneClick: false` and
`allowToChangeInstallationDirectory: true`. Missing:

- `installerIcon` / `uninstallerIcon`
- `createDesktopShortcut` / `createStartMenuShortcut`
- Explicit architecture targets (macOS explicitly lists x64+arm64)
- ZIP portable format (macOS ships both DMG and ZIP)

**File:** `electron-builder.yml:57-60`

---

## electron-builder: no Windows code signing

No `certificateFile` or signing hooks are configured. Users will see "Unknown
Publisher" warnings from SmartScreen during installation.

**File:** `electron-builder.yml`

---

## Auto-updater: asymmetric macOS vs Windows paths

macOS uses a custom updater (`MacCustomUpdater`) with SHA-512 verification and
retry logic. Windows uses standard `electron-updater` with no custom
verification layer. Different reliability characteristics.

**File:** `auto-updater.ts:9-53`, `mac-updater.ts`

---

## Auto-updater: Windows cache path construction

Line 129–135 builds the Windows cache path as `appData/../Local/name` instead
of using `app.getPath("userData")` or similar. Functional but fragile.

**File:** `auto-updater.ts:129-135`

---

## CSS font smoothing

`-webkit-font-smoothing: antialiased` is applied globally. On Windows, this
WebKit property is ignored by Chromium's DirectWrite renderer, but the
`antialiased` hint can make text appear thinner than native ClearType rendering
on some configurations.

**File:** `src/index.css:83-84`

---

## pty-manager: xterm-256color terminal name

`name: "xterm-256color"` may not be recognized by all Windows terminal
applications. Consider `"xterm"` as fallback on Windows.

**File:** `pty-manager.ts:23`

---

## process-detector: tmux detection is Unix-only

`tmux` is not a native Windows tool. The code catches the failure gracefully
(not a crash), but tmux session detection is non-functional on Windows.

**File:** `process-detector.ts:134`
