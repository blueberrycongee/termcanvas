# Changelog

All notable changes to TermCanvas will be documented in this file.

## [0.8.6] - 2026-03-19

### Fixed
- Composer: restore delay between bracketed paste and Enter key
- Usage panel: include cache creation tokens in cache hit rate denominator

## [0.8.5] - 2026-03-19

### Added
- Composer: drag-and-drop support for files and images
- Usage panel: cache rate section in right panel
- Shortcuts: Cmd+D to close focused terminal
- Updater: error state UI with retry button in update modal

### Fixed
- Composer: add delay before submit when images are attached
- Composer: clean up staged image temp files on each new submit
- Composer: correct paste+submit write coalescing
- Hydra: auto-unblock stalled sub-agents during poll cycles

## [0.8.4] - 2026-03-19

### Fixed
- Browser card: improve webview compatibility — add persistent session, allowpopups, sanitize User-Agent, handle new-window and load errors
- Usage panel: filter out synthetic and unknown model entries from stats

### Changed
- Shortcuts: show keyboard hints on-demand instead of always visible

## [0.8.3] - 2026-03-19

### Added
- Composer: add /skills slash command for Claude and Codex
- Sidebar: unified Figma-style collapsible panels

### Fixed
- Hydra: add concrete permission self-check before spawning sub-agents
- Composer: prevent slash command menu from reopening after dismiss
- Composer: match Codex /skills description to actual CLI
- Drawing panel: prevent panel from being hidden by composer and escaping viewport
- Usage panel: align heatmap with GitHub contribution graph style
- Usage panel: prevent tooltip clipping

## [0.8.2] - 2026-03-19

### Fixed
- Usage panel: batch heatmap data collection into single file scan (91 IPC calls → 1), fixing app freeze when opening usage panel

## [0.8.1] - 2026-03-19

### Fixed
- Drawing panel: constrain drag to viewport bounds, preventing panel from being dragged off-screen
- Composer: fix slash command selection resetting to first item on every keystroke
- Cmd+O: center newly created project in current viewport instead of top-left
- Usage panel: fix hover tooltip positioning (translateX offset) and i18n for heatmap tokens label
- Usage panel: remove dead code (unused dayOfMonth field and tooltipRef)

### Added
- Usage panel: GitHub-style token heatmap calendar showing daily usage over 91 days

## [0.8.0] - 2026-03-19

### Added
- Composer: slash command autocomplete — type `/` to see available commands for the focused terminal's agent type (Claude, Codex)
- Usage panel: interactive date navigation with mini calendar popup, days with data show dot indicators
- Usage panel: enhanced hover states with floating tooltips on sparkline bars, token breakdown, projects, and models
- Usage panel: micro-animations — section fade-in, sparkline bar growth, cost count-up transitions
- Hierarchy: parent-child terminal visualization with SVG bezier connection lines on the canvas
- Hierarchy: terminal badges showing parent/child relationships with click-to-pan navigation
- Hierarchy: hover-to-reveal family tree overlay showing full agent hierarchy
- Hierarchy: `TERMCANVAS_TERMINAL_ID` env var injected into PTY for Hydra auto-detection
- Focus: tree-aware Cmd+[] cycling — DFS pre-order traversal groups parents with their children

### Changed
- Usage panel: larger 24px cost display, inset dividers, improved spacing rhythm

## [0.7.23] - 2026-03-19

### Fixed
- Session watcher: return success/failure from watch() instead of void
- Session: surface watch failures and poll timeouts to the user
- Persistence: log errors in state load/restore instead of silently swallowing
- Session watcher: match Claude CLI projectKey algorithm for paths containing dots
- Terminal: use onScroll as single source of truth for follow-bottom

### Changed
- Demo: rewrite ASCII logo to canvas text rendering for 120fps with true-color gradients

## [0.7.22] - 2026-03-18

### Fixed
- Session capture: use actual CLI process PID for auto-detected terminals, fixing completion glow never appearing
- Session watcher: support detecting multiple turn completions per session
- Session watcher: increase JSONL tail read size from 4KB to 128KB for longer sessions

## [0.7.21] - 2026-03-18

### Changed
- Composer bar: halved vertical footprint, send button moved inside input, notes replaced with placeholder text

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
