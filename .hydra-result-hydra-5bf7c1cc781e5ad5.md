# Hydra Analysis Result: Issue #99 — Theme switch leaves CLI input boxes in previous theme

## Files Changed
- `.hydra-result-hydra-5bf7c1cc781e5ad5.md` — this analysis file (required by Hydra protocol)

## Analysis Summary

### Issue Description
Switching between dark/light themes leaves some CLI input boxes (inside terminal tiles) displaying the old theme's colors, while the rest of the UI updates correctly.

### Root Cause Analysis

**The bug has two independent layers, both confirmed by code inspection:**

#### Layer 1: TermCanvas's own xterm theme update works correctly — not the bug
The app's theme pipeline for its own UI is solid:
1. `toggleTheme()` in `src/stores/themeStore.ts:28-38` sets `data-theme` on `document.documentElement` and persists to localStorage.
2. All React UI components (ComposerBar, Toolbar, SettingsModal, TerminalTile chrome) use CSS custom properties (`var(--bg)`, `var(--surface)`, `var(--text-primary)`, etc.) defined in `src/index.css:34-77`. These update instantly when `data-theme` changes.
3. Each xterm instance subscribes to the zustand theme store and updates its `options.theme` + calls `refresh()` in `src/terminal/TerminalTile.tsx:768-779`. This correctly repaints the xterm canvas background and ANSI color palette.

**This layer is NOT the bug.**

#### Layer 2: CLI processes inside xterm render their own TUI UI with hardcoded/cached colors — THIS IS THE BUG

The CLI tools running inside xterm terminals (Claude Code, Codex, Kimi, Gemini, OpenCode, lazygit) are independent processes with their own TUI rendering:

1. **No theme signal is sent to CLI processes.** The PTY environment (`electron/pty-launch.ts:374-441` and `electron/pty-manager.ts:22-28`) sets `TERM=xterm-256color` but does NOT set `COLORFGBG`, `COLORTERM`, or any custom theme environment variable. There is no mechanism to notify running CLI processes of a runtime theme change.

2. **CLI tools use truecolor/256-color escape sequences for their UI.** Tools like Claude Code (Ink/React-based TUI), Codex, lazygit, etc. render input boxes, prompts, and chrome using hardcoded or startup-cached ANSI escape sequences (e.g., `\x1b[38;2;R;G;Bm` truecolor sequences). These colors are baked into the terminal output stream and persist in the xterm scrollback buffer.

3. **xterm theme update only affects the 16-color ANSI palette, not truecolor.** When `xterm.options.theme = XTERM_THEMES[state.theme]` is called (line 773), it remaps the 16 named ANSI colors (black, red, green, etc.) and the background/foreground defaults. But CLI tools that emit truecolor RGB sequences (24-bit color) or 256-color palette references are NOT affected by this remapping — those absolute color values remain unchanged in the terminal buffer.

4. **The affected "input boxes" are CLI-rendered TUI elements.** For example:
   - Claude Code's input prompt area (rendered by Ink with specific RGB colors)
   - Codex's input/status bars
   - lazygit's panel borders and input fields

   These are NOT HTML `<input>` elements or TermCanvas React components — they are character-cell TUI widgets painted via ANSI escape sequences inside the xterm canvas.

### Concrete Code Paths

| Step | File | Lines | What happens |
|------|------|-------|--------------|
| User clicks theme toggle | `src/toolbar/Toolbar.tsx` | 128 | Calls `toggleTheme()` |
| Theme state updates | `src/stores/themeStore.ts` | 28-38 | Sets `data-theme`, updates zustand store |
| CSS variables update | `src/index.css` | 34-77 | `[data-theme="light"]` overrides all `--*` vars |
| xterm palette updates | `src/terminal/TerminalTile.tsx` | 768-779 | `xterm.options.theme = XTERM_THEMES[state.theme]`; `xterm.refresh()` |
| **CLI process NOT notified** | `electron/pty-manager.ts` | 22-28 | PTY created with `name: "xterm-256color"`, no theme env vars |
| **CLI process NOT notified** | `electron/pty-launch.ts` | 374-441 | `buildLaunchSpec` never sets COLORFGBG or similar |
| **Truecolor output unchanged** | (xterm internals) | — | `refresh()` only repaints using current palette; hardcoded RGB in buffer cells stays |

### Hypothesis Evaluation

> Hypothesis: "theme changes only update xterm renderer state, but some CLI input boxes are self-rendered truecolor/TUI UI and are not notified of runtime theme changes"

**I AGREE with this hypothesis.** It is correct and well-stated. My analysis confirms:

1. Theme changes DO correctly update xterm's palette and force a canvas repaint.
2. CLI input boxes ARE self-rendered TUI widgets using truecolor/256-color escape sequences.
3. No mechanism exists to notify running CLI processes of theme changes (no env var update, no escape sequence signal, no IPC).
4. The truecolor RGB values in the xterm buffer are absolute and are NOT remapped by xterm's theme/palette system.

### Potential Fix Directions (analysis only, no code changes)
1. **Send OSC 11/10 sequences** to the PTY when theme changes, so CLI apps that listen for background/foreground color queries can detect the change. (Most sophisticated TUI apps respond to these.)
2. **Set `COLORFGBG` environment variable** at PTY launch time to hint light/dark, and send SIGWINCH to running processes on theme change to trigger TUI redraws.
3. **Accept this as expected behavior** — most terminal emulators (iTerm2, Alacritty, kitty) have the same limitation where CLI TUI colors persist across theme switches until the app redraws.

## Tests
- N/A (analysis-only task, no code changes)

## Unresolved Problems
- None. The root cause is clearly identified.
