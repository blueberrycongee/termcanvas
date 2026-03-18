# Changelog

All notable changes to TermCanvas will be documented in this file.

## [0.7.20] - 2026-03-18

### Added
- Terminal font size setting in Settings (9–24px slider)
- Non-intrusive update indicator in toolbar with status icons (checking, downloading, ready, error)
- Keyboard shortcuts (Cmd+[/]) now auto-focus the Composer

### Fixed
- Usage pricing: Haiku 4.5 updated from stale 3.5 prices, cache writes split into 5m/1h tiers
- Usage stats: recursive JSONL scan captures subagent sessions, correct project path extraction
- Update modal: fixed transparent background and restart not working on macOS
- Terminal origin indicator moved from border to title bar dot, no longer conflicts with hover/focus

### Changed
- Update flow: silent background download, toolbar indicator replaces intrusive popup modal

## [0.7.19] - 2026-03-18

### Fixed
- Terminal scroll position no longer drifts upward during streaming output when user has scrolled up to read earlier content
- Replaced ResizeObserver-driven fitAddon.fit() with React state-driven fitting to prevent xterm resize/reflow from nudging viewport position

## [0.7.18] - 2026-03-18

### Added
- Auto-update: the app now checks for updates automatically and prompts to install
- Changelog displayed in update dialog with markdown rendering
- Gold border on user-created terminals to distinguish from agent-spawned ones
- Cmd+Arrow keys in Composer forward to CLI for history/cursor navigation
- Empty Enter in Composer passes through to CLI for confirming prompts

### Fixed
- Composer now uses bracketed paste for Claude Code, eliminating clipboard race conditions
- Re-entrancy guard in Composer prevents double submission
- Delay between bracketed paste and Enter key so CLI processes input before submission

### Changed
- All AI CLI terminals (Claude, Codex, Kimi, Gemini, OpenCode) migrated from clipboard paste to bracketed paste
