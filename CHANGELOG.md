# Changelog

All notable changes to TermCanvas will be documented in this file.

## [0.17.0] - 2026-04-01

### Added
- Terminal stash box: park running terminals and restore them later with PTY kept alive
- Drag-to-stash: drag a terminal past its worktree boundary to stash it
- Right-click context menu "Stash" action on terminal tiles
- StashBox panel (bottom-right) to manage stashed terminals
- Browse tool: headless Chromium sub-package with CLI client and HTTP daemon
- Browse commands: navigation, interaction, screenshots, snapshots, cookies
- QA skill for browser-based testing workflows
- File tree watcher: per-directory fs.watch with IPC bridge
- Rescan watched directories on window focus
- Investigate, security-audit, and code-review skills

### Improved
- CLI type detection runs on fixed 1-second interval instead of 3-second idle debounce, no longer blocked by active output
- Stashed terminals stay in worktree with TerminalRuntimeHandle mounted (same as collapse), preventing PTY interruption
- Remaining terminals reflow when a sibling is stashed

### Fixed
- xterm v6 text cursor override
- Canvas willChange hit-test offset during animation
- Keyboard Backspace terminal delete now requires confirmation
- React state updater side effect in file tree hook
- xterm scrollToBottom crash on disposed instance during restore

## [0.16.14] - 2026-03-31

### Added
- Detect Codex bypass state (approval_policy + sandbox_policy) from session JSONL

### Improved
- Scan JSONL backwards in 64KB chunks (up to 512KB) instead of fixed tail read

## [0.16.13] - 2026-03-30

### Fixed
- Read Claude permissionMode from session JSONL to persist bypass permissions across restarts
- Refresh Claude sessionId and permissionMode before save to capture /resume switches

## [0.16.11] - 2026-03-30

### Fixed
- Persist CLI auto-approve flag (e.g. --dangerously-skip-permissions) across app restarts

### Improved
- Stagger non-focused PTY spawns on restore to reduce fork storm

## [0.16.10] - 2026-03-30

### Added
- Click collapsed sidebar to expand, with hover highlight
- Enable autoplay on welcome overlay

## [0.16.9] - 2026-03-30

### Fixed
- Minimized terminal tile showing xterm content over header instead of title bar with restore button

## [0.16.8] - 2026-03-30

### Fixed
- Resolve worktree overlaps when tile dimensions change (window resize, sidebar drag)

## [0.16.7] - 2026-03-30

### Added
- "Don't remind" option in Hydra setup popup to suppress per-project prompts for the session

## [0.16.6] - 2026-03-30

### Added
- Agent terminal freeze during sidebar drag — xterm stays frozen at pre-drag size with zero PTY resize, zero flicker; commits one fit on drag-end
- Buffer snapshot and reflow engine for agent terminals

### Fixed
- Skip redundant focus dispatch in panToTerminal when terminal is already focused
- Account for left panel inset in canvas coordinate transforms (box select, family tree overlay, viewport calculations)

## [0.16.5] - 2026-03-30

### Fixed
- Left panel resize handle sticking after pointer capture loss

## [0.16.4] - 2026-03-30

### Added
- Dynamic terminal tile aspect ratio based on available viewport size
- Manual check-for-updates button in settings

### Fixed
- Skip collapsed/minimized terminals in focus navigation
- Prepend space before dropped file path in PTY input
- Destroy orphaned PTYs on renderer reload to prevent FD leak
- Recompute terminal position on focus to avoid stale geometry after sidebar resize
- Improve markdown preview readability and visual hierarchy

## [0.16.3] - 2026-03-29

### Fixed
- Kill process group before removing PTY instance on resize error
- Restrict token and device-id file permissions to owner-only
- Resolve theme-related visual issues across multiple components
- Add 8px inset to terminal tiles within worktree containers
- Remove selection outline from terminal tiles
- Do not trigger onOpenFile when deselecting a memory graph node
- Register welcome drag listeners on step 4 instead of step 3
- Add try/catch to login() to prevent permanent loginPending lock
- Remove terminal tile border classes and inner padding
- Remove terminal tile border and light-only box-shadow
- Deduplicate SessionStart hook by script name to prevent dev/prod double registration
- Account for left sidebar in viewport centering calculations

## [0.16.2] - 2026-03-29

### Fixed
- Left panel tabs collapse to icons only when panel width is narrow, preventing text wrapping to two lines

## [0.16.1] - 2026-03-29

### Fixed
- Memory SessionStart hook now registered in Claude Code settings.json with absolute path (plugin hooks.json alone was not loaded by Claude Code)

## [0.16.0] - 2026-03-29

### Added
- Memory enhancement plugin: SessionStart hook injects explicit references and time-sensitive warnings into Claude Code context
- Enhanced memory index generator: extracts cross-file markdown links and expired date detection
- `GET /api/memory/index` API endpoint for hook integration
- Memory Graph navigation skill: instructs agent to follow references and verify stale memories
- Auto-enable TermCanvas plugin in Claude Code settings.json on startup (required for hooks)
- OS file drop into project file tree with drag-and-drop copy
- Auto-expand collapsed left panel and directories on OS file drag hover

### Fixed
- Hook script reads both dev/prod port files and bypasses proxy for localhost
- Shell injection in hook script prevented via stdin parameter passing
- Render loop no longer rebuilds on hover/select state changes (uses refs)
- MEMORY.md read and watch callback exceptions caught to prevent main process crash
- Regex lastIndex reset between nodes in date expiry detection
- Worktree root directory no longer exposed to rename/delete in file tree context menu
- Path traversal in rename/mkdir/createFile blocked by basename validation
- Windows backslash and drive letter paths handled in memory directory derivation
- PreviewContent saveAndExit no longer gets stuck on write failure
- Dead `memory:read-file` IPC removed, CSS variables cached to avoid per-frame getComputedStyle

## [0.15.1] - 2026-03-29

### Fixed
- Memory graph background now matches panel surface color instead of being too dark
- Tooltip opacity rendering fixed for Tailwind v4 compatibility

## [0.15.0] - 2026-03-29

### Added
- Memory tab in left panel: visualize Claude Code memory files as a force-directed knowledge graph
- Graph features: theme-aware colors, multi-level emphasis on hover/select, glow effects, arrow edges, hover tooltip
- Live memory graph updates via fs.watch when memory files change
- Click memory node to open in Preview tab
- Click-to-edit for all text/markdown files in Preview (auto-save on blur, ⌘S save, Esc cancel)
- General `fs:writeFile` IPC with content comparison to avoid unnecessary writes

### Fixed
- Preview close now returns to originating tab (Memory or Files) instead of always Files
- Canvas resize flicker eliminated by deferring resize to render loop
- File writes skip when content unchanged, preserving mtime for accurate freshness signals

## [0.14.0] - 2026-03-28

### Added
- Headless runtime: Electron-free Node.js runtime enabling Hydra to run inside cloud VMs (project-store, api-server, heartbeat, artifact-collector)
- Dynamic panel-aware centering: focused terminals stay centered between both panels regardless of panel state
- Real-time re-center during left panel resize drag
- Left panel markdown preview with source toggle
- Hydra setup popup replacing inline banner
- Persistent Hydra status banner replacing transient toast
- Auto-check Hydra toolchain status on project focus
- Hydra sub-agents default to auto-approve

### Fixed
- Viewport scale calculation now accounts for left panel width, preventing terminal occlusion
- Panel resize re-center uses immediate viewport update for smooth tracking
- Suppress stale copied toast on terminal remount
- Prevent selection jump when mouse re-enters terminal during zoom

## [0.13.0] - 2026-03-28

### Added
- Hydra plan approval gate: `--approve-plan` flag pauses workflow after planner for user review
- `hydra approve` command to continue approved plans to implementation
- `hydra revise --feedback "..."` command to re-run planner with structured feedback
- Human-in-the-loop plan cycle: user → main brain → planner → review → revise/approve → implement → evaluate

### Fixed
- Hydra requeue now only deletes done marker, preserving result.json for downstream agents (evaluator findings for implementer, old plan for revised planner)
- Git panel graph rail tightened to shift visual weight toward text

## [0.12.1] - 2026-03-27

### Fixed
- PTY leak: terminal destroy now sends SIGHUP to the entire process group instead of SIGTERM to the shell only, preventing orphaned Claude CLI and MCP server processes from accumulating and exhausting the system PTY limit
- Quota panel: show error state instead of hiding the section on fetch failure

## [0.12.0] - 2026-03-27

### Added
- Hydra planner: three-phase structure (investigate → constrain → plan) replacing direct task decomposition
- Hydra planner: domain-specific audit guides (frontend, backend, infra) loaded on demand
- Hydra evaluator: constraint and problem verification anchored to planner output
- Hydra evaluator: regression check dimension — verify git diff doesn't break existing functionality

### Changed
- Left panel: removed standalone preview tab (preview is reached by clicking a file, not a tab)
- Left panel: segmented tab bar with icons, collapsed icon strip, Hydra button relocated to git toolbar

### Fixed
- Left panel: git history scroll regression caused by missing flex height constraints in CollapsibleGroup

## [0.11.0] - 2026-03-27

### Added
- Hydra evaluator: structured `verification` field in result.json for tier-level reporting (runtime/build/probing/static)
- Hydra evaluator: domain-specific evaluation guides (frontend, backend, infra) loaded on demand
- Hydra workflow: telemetry-based early exit detection — retries within seconds instead of waiting for timeout
- Hydra workflow: eager terminal destruction after handoff completion to prevent PTY/process accumulation

### Changed
- Hydra evaluator prompt rewritten to focus on deep evaluation (intent alignment, stub detection, test quality, architectural fit) instead of just CI checks
- Hydra watch defaults increased to 30s poll interval and 1h timeout

### Fixed
- Hydra loop requeue: stale done/result files no longer cause infinite phantom completion cycles
- Hydra cleanup: now destroys terminals for all handoffs in a workflow, not just the current one

## [0.10.0] - 2026-03-27

### Added
- Git graph layout engine with tighter rail spacing for branch visualization
- Hydra evaluator upgraded from code reviewer to QA engineer with tiered verification strategy

### Fixed
- Terminal PTY spawn now retries on transient failures
- Git push/pull no longer hangs on auth prompts; stderr properly captured with 30s timeout
- Left panel (git, files, diff) no longer goes blank when clicking canvas background

## [0.9.1] - 2026-03-27

### Fixed
- Hydra: remove hardcoded codex default for implementer role, use flexible agent resolution chain
- Hydra: add agent characteristics (Claude vs Codex strengths) to hydra skill for provider selection guidance

## [0.9.0] - 2026-03-27

### Added
- Hydra orchestration system: task handoffs, workflow commands, planner-implementer-evaluator template
- Hydra telemetry truth layer with query APIs and UI advisory views
- Git panel in the left sidebar with staging, commit, push/pull, branch switching, and commit history
- One-click hydra project enable button
- CLI command routing to the active termcanvas instance
- Termcanvas router skill

### Changed
- Redesigned git sidebar panel layout and inspector
- Left panel resize now uses pointer capture for smoother interaction

### Fixed
- Git panel bottom dead space eliminated; history fills remaining space
- Diff line backgrounds extend to full scrollable width on horizontal scroll
- Commit detail panel no longer overlaps history items
- Terminal title controls visibility restored
- Terminal auto-copy focus regression resolved
- Worktree header actions no longer re-expand legacy nodes

## [0.8.57] - 2026-03-25

### Changed
- Simplified canvas interaction by removing DiffCard and FileTreeCard components

### Fixed
- Menu handler no longer depends on terminal state variable

## [0.8.56] - 2026-03-25

### Added
- Codex quota display in the usage panel

### Changed
- Reduced usage panel polling frequency
- Refined compact worktree sizing and visible worktree bounds for layout alignment


## [0.8.55] - 2026-03-24

### Fixed
- Restore the copied toast to a solid surface so it stays legible above the canvas
- Fix cascading worktree overlap reflow so neighboring worktrees keep a stable layout
- Align quoted wrapper command parsing so CLI launches resolve correctly

## [0.8.54] - 2026-03-24

### Fixed
- Installing a downloaded update now goes through the normal shutdown path so app cleanup runs before handing off to the updater
- Restart-to-install no longer gets stuck behind the unsaved-changes dialog, and canceling that dialog clears the pending restart intent safely

## [0.8.53] - 2026-03-24

### Fixed
- Restore CLI message color hierarchy in light mode so user prompts and AI responses remain visually distinct after a theme-triggered redraw

## [0.8.52] - 2026-03-24

### Performance
- Reduce renderer focus and snapshot churn during canvas interactions
- Cache usage heatmap results per session file to avoid repeated recomputation

### Fixed
- Defer and cancel queued xterm focus when switching terminals across projects so CLI focus no longer lags behind visual focus
- Keep empty worktrees expanded after removing their last terminal

## [0.8.51] - 2026-03-24

### Performance
- Reduce main-process stalls during usage session scans
- Defer usage heatmap loading until the heatmap section is visible, so opening the right panel no longer triggers a multi-second heatmap scan
- Avoid idle background stalls from hidden usage prefetch and repeated autosave backstop snapshots

### Fixed
- Improve hover card drag stability
- Keep related hover cards visible during drag

## [0.8.50] - 2026-03-24

### Changed
- macOS title bar now uses a more native three-part layout with centered workspace title and grouped controls
- Toolbar actions and zoom controls now share a more consistent visual grouping and spacing rhythm

### Fixed
- Electron production builds now externalize `adm-zip` correctly so release packaging does not fail during the main-process bundle step

## [0.8.49] - 2026-03-23

### Fixed
- Theme switches now notify running CLI terminals to redraw, reducing stale light/dark input box styling after a theme toggle
- New terminals inherit explicit theme hints in their PTY environment so CLI tools start with the correct light/dark context

## [0.8.48] - 2026-03-23

### Performance
- Convert worktree rescans from blocking sync git commands to async execution
- Skip no-op worktree sync updates to avoid unnecessary canvas rerenders

## [0.8.47] - 2026-03-23

### Changed
- Hydra polling interval now adapts based on task duration (short tasks poll faster)
- Reduced default Hydra polling frequency from 30s to 2 minutes

### Performance
- Convert quota-fetcher from execSync to async execFile/fetch
- Convert project:diff from execSync to async execFile

### Fixed
- Hydra skill set to alwaysApply so polling instructions are always loaded
- Hub spring animations, glass material, and position refinements

## [0.8.46] - 2026-03-23

### Added
- Terminal rename skill (`/termcanvas:rename`): AI generates a concise tab title from conversation context
- CLI `terminal set-title` command and `PUT /terminal/{id}/custom-title` API route
- Hub component for layered focus navigation across projects and worktrees
- Auto-collapse worktrees when their last terminal is removed

### Changed
- Skill distribution migrated from per-skill symlinks to Claude Code plugin system
- Removed Sidebar component in favor of Hub navigation
- Removed Hydra connection line overlay (parent-child navigation via HierarchyBadges)

### Fixed
- Improved text-muted contrast for better readability
- Windows: correct path joining for CLI artifacts

## [0.8.45] - 2026-03-23

### Fixed
- Usage panel: cache rate now uses local device data only, avoiding inaccurate mixed cloud/local percentages (#62)
- Usage panel: show all 24h time buckets for past dates (#61)
- Light sweep effect: improved visibility and fixed right-side trigger (#19)
- Preserve permission level (auto-approve) when restoring Claude sessions (#14)
- Hydra usage now attributed to spawning project instead of separate entry (#21)
- Windows: replace Unix `unzip` with cross-platform `adm-zip` for font downloads (#32)
- Windows: normalize Claude project keys for correct session matching (#63)
- Windows: use `pathToFileURL()` for valid file URLs when opening reports (#64)
- Windows: use junctions instead of symlinks for Hydra skill links (#66)

## [0.8.44] - 2026-03-23

### Fixed
- Usage panel: Codex cached tokens were double-counted in cost calculation — OpenAI's input_tokens includes cached_input_tokens, unlike Claude's API

## [0.8.43] - 2026-03-23

### Fixed
- Hydra connection lines hidden behind ProjectContainer
- Insights "Open Report" option lost after app restart — now scans for latest report on mount

## [0.8.42] - 2026-03-23

### Fixed
- Usage panel: cloud heatmap was not aggregating across devices due to missing polling retry and TokenHeatmap reading local-only data

## [0.8.41] - 2026-03-22

### Fixed
- Usage panel: server-side aggregation via Supabase RPC to avoid 1000-row query truncation
- Usage panel: content-based dedup (record_hash) replaces timestamp-based dedup to prevent same-second data loss
- Usage panel: per-day max merge for heatmap so incomplete cloud data doesn't overwrite local

### Changed
- Sidebar uses distinct background color for light and dark themes

## [0.8.40] - 2026-03-22

### Fixed
- Usage panel: merge local + cloud heatmap data so pre-login days appear in the heat map
- Usage panel: monthly total now includes local usage from before cloud sync
- Usage panel: daily summary (cost, sessions, tokens) uses the larger of cloud vs local to avoid data loss during backfill
- Usage panel: hourly activity chart merges cloud + local buckets for complete daily view

## [0.8.39] - 2026-03-22

### Fixed
- Auth: rewrite OAuth callback server with proper error handling, PKCE support, and 120s timeout
- Auth: surface Supabase error details instead of generic "Login failed" message
- Auth: handle EADDRINUSE when callback port is occupied
- Settings: prevent keyboard shortcuts list from overflowing the modal
- Theme: persist dark/light mode choice to localStorage across sessions
- Workspace: mark project dirty when renaming a terminal tab
- Drag & drop: quote file paths containing spaces or special characters

### Internationalization
- Canvas: internationalize empty state onboarding text (en/zh)
- Update modal: internationalize all UI strings (en/zh)

## [0.8.33] - 2026-03-22

### Fixed
- Insights: pipe long prompts via stdin to avoid E2BIG crash when analyzing 1000+ sessions
- Insights: early-reject codex_exec self-insight sessions during parsing to prevent snowball scanning

## [0.8.32] - 2026-03-22

### Fixed
- GitHub login callback now correctly updates user state and displays account name
- Expanded GitHub username extraction to cover more OAuth metadata fields

## [0.8.31] - 2026-03-22

### Added
- Insights V2: unified cross-CLI report analyzing both Claude Code and Codex sessions together
- Insights V2: time-decay tiers for session analysis (full/50%/25%/metrics-only by age)
- Insights V2: "Your Coding Story" section with achievement wall and AI-generated memorable moments
- Insights V2: time trends chart showing 14-day daily activity breakdown
- Insights V2: tool comparison cards (Claude Code vs Codex side-by-side)
- Insights V2: automatic report language detection matching user's conversation language

### Changed
- Insights: removed hard caps on facet extraction and session loading for full coverage
- Insights: each analysis round now receives section-specific data slices instead of identical context
- Insights: satisfaction inference prompt now includes a concrete rubric instead of bare field name

### Fixed
- Insights: time-of-day heatmap now aggregates from all eligible sessions, not just facet-backed ones
- Insights: report header now shows three-stage counts (scanned/eligible/facet-backed) instead of misleading ratio
- Insights: compact mode button no longer locks into "open report" after generation, allowing re-generation
- Insights: success banner in full mode can now be dismissed

## [0.8.30] - 2026-03-21

### Changed
- Insights: extract richer per-session metrics from Claude and Codex logs, including tool usage, token usage, response timing, language signals, git activity, line deltas, and workflow feature flags
- Insights: upgrade report synthesis from freeform markdown blocks to structured analysis sections with actionable cards, copyable prompts, and partial-section resilience
- Insights: redesign the generated HTML report with a richer dashboard, time-of-day heatmap, stronger breakdowns, and explicit coverage/error visibility

### Fixed
- Insights: long sessions no longer collapse into a head-only transcript snippet, improving facet quality for multi-step runs
- Insights: analysis failures in one section no longer abort the whole report generation pipeline

## [0.8.29] - 2026-03-21

### Changed
- macOS auto-update no longer requires Apple Developer code signing certificate
- Custom updater downloads ZIP from GitHub Releases, verifies SHA-512, and replaces the .app bundle
- Downloaded updates persist across app restarts; auto-install on quit
- Download retry with exponential backoff (up to 3 retries)
- Install script backs up old .app and restores on failure

### Fixed
- macOS auto-update failing with "Code signature did not pass validation"

## [0.8.28] - 2026-03-21

### Changed
- Insights: generate reports per selected CLI instead of mixing Claude and Codex sessions in one run
- Insights: freeze each run's session set, add bounded uncached processing, and surface analyzed/scanned/cache coverage in the HTML report

### Fixed
- Insights: avoid cross-run progress event bleed by isolating jobs with a per-run job id and single-job guard
- Insights: reuse session metadata and facet caches with source fingerprints so stale or mismatched cache entries are not silently reused
- Insights: package report generation code into the desktop build so packaged releases can finish generating insights reports

## [0.8.27] - 2026-03-21

### Added
- Supabase backend: GitHub OAuth login and cross-device usage sync
- Incremental usage sync every 5 minutes when logged in
- One-time history backfill on first login

### Security
- Disable email signup, GitHub OAuth only
- Row-level security on usage_records table

### Fixed
- Dev and production instances on the same machine no longer double-count usage

## [0.8.26] - 2026-03-21

### Changed
- Performance: batch PTY output into 8ms frames to reduce IPC flooding with many terminals
- Performance: cull off-screen projects via content-visibility to skip rendering work
- Performance: pool WebGL contexts (max 8) with LRU eviction to stay under browser limits

## [0.8.25] - 2026-03-21

### Added
- Shortcuts: `Cmd+/` to toggle right panel, `Cmd+F` to star/unstar focused terminal, `Cmd+J`/`Cmd+K` to cycle starred terminals
- Settings: all shortcuts now configurable in settings panel (added save, save-as, close, star, starred nav)
- Settings: continuous minimum contrast ratio slider (1–7) for terminal text readability

### Fixed
- Light mode: ANSI black text nearly invisible against light background
- Light mode: cyan and blue ANSI colors too faint for readability
- Light mode: truecolor text (e.g. Claude Code links/hashes) enforced via xterm.js minimumContrastRatio

## [0.8.24] - 2026-03-21

### Added
- Usage panel: real-time Claude Code quota display showing 5-hour and 7-day rate limit utilization with adaptive polling driven by local usage activity

## [0.8.23] - 2026-03-21

### Changed
- Hydra: skill docs now explicitly document `kimi` support and clarify that `--auto-approve` is ignored for Kimi agents

### Fixed
- Hydra/Kimi: launch initial sub-agent tasks with Kimi's required `--prompt` flag so spawned Kimi terminals actually receive the task
- Terminal: when composer is off, `Cmd+;` / `Ctrl+;` now focuses the terminal and opens the inline custom title editor instead of falling back to a detached prompt flow

## [0.8.22] - 2026-03-21

### Changed
- Fonts: downloadable font sources now use pinned GitHub release archives instead of the old Google Fonts ZIP endpoints
- Fonts: temporarily limit bundled download choices to verified archives (JetBrains Mono, Fira Code, IBM Plex Mono, Hack) until the removed sources are fixed

### Fixed
- Fonts: follow HTTP redirects and download archives through Node `https`, fixing font installs that were failing in both dev mode and packaged builds

## [0.8.21] - 2026-03-21

### Added
- Settings: Agents tab with auto-detect, manual CLI path override, and Validate button for claude/codex/kimi/gemini/opencode
- Settings: CLI command configuration persisted in preferences (cliCommands)
- IPC: cli:validate-command resolves executable path and reports version
- Terminal: actionable error message when agent CLI is not found, pointing to Settings > Agents
- Settings: drawing tools toggle (default off)
- Usage: monthly cost total in usage panel

### Changed
- Terminal: getTerminalLaunchOptions accepts optional cliOverride from user preferences
- Settings: modal state extracted to zustand store, openable from any component to a specific tab
- PTY: structured PtyLaunchError with code and command fields

### Fixed
- Font download button unresponsive due to disabled parent element
- Composer: default to off, marked as experimental
- i18n: corrected Chinese terminal title placeholder and composer rename prompts

## [0.8.20] - 2026-03-20

### Added
- Onboarding: interactive mini canvas tutorial with double-click focus, Cmd+E toggle (focus/fit-all), Cmd+]/[ terminal switching, and scroll zoom/drag pan steps
- Onboarding: all navigation shortcuts work across all tutorial steps, matching real app behavior
- Toolbar: tutorial button to reopen onboarding anytime
- Save: auto-save with dirty tracking, workspace file persistence, and dirty-aware title bar
- Save: Cmd+S / Cmd+Shift+S shortcuts for save and save-as

### Changed
- PTY: graceful shutdown with SIGTERM → 5s timeout → SIGKILL
- State: atomic state.json writes via tmp+rename
- Theme: revert completion glow theme changes

### Fixed
- Theme: disable allowTransparency to fix text fringing
- Theme: darken bright ANSI colors and terminal text for light mode readability
- Electron: isolate dev instance data directory and skip single-instance lock in dev mode
- Composer: rename terminal markers from composer

## [0.8.19] - 2026-03-20

### Fixed
- Theme: soften light mode terminal foreground for reverse video readability
- Fonts: show error notification when font download fails

### Changed
- Theme: redesign light mode with warm stone-toned palette and reduced brightness

## [0.8.18] - 2026-03-20

### Added
- Settings: terminal font selection with 10 curated monospace fonts (Geist Mono, Geist Pixel Square, JetBrains Mono, Fira Code, Source Code Pro, IBM Plex Mono, Inconsolata, Cascadia Code, Hack, Victor Mono)
- One-click font download for non-bundled fonts, stored in app data directory
- Real-time font switching across all terminal instances

## [0.8.17] - 2026-03-20

### Fixed
- Composer: prevent Enter from selecting slash command without explicit arrow-key navigation, fixing accidental command selection when submitting partial input

## [0.8.16] - 2026-03-20

### Fixed
- Terminal: remove manual scroll management that overrode xterm v6 built-in scroll-pinning, fixing viewport snapping to bottom during AI streaming output

## [0.8.15] - 2026-03-20

### Fixed
- Composer: per-terminal paste strategy so image+text submissions work correctly for both Claude Code and Codex

## [0.8.14] - 2026-03-20

### Fixed
- Composer: send each bracketed paste as a separate pty write so image paths and text are recognised as distinct inputs
- Composer: route all terminal types through Composer for input focus
- Terminal: use xterm v6 onScroll API for scroll-pinning instead of viewport DOM events

## [0.8.13] - 2026-03-20

### Fixed
- Terminal: rewrite scroll-pinning to use input events (wheel/keydown) instead of scroll events, fixing viewport not following output during AI streaming
- Terminal: fix Cmd+Backspace referencing undeclared variable
- Composer: send all bracketed pastes in a single write to eliminate race condition

## [0.8.12] - 2026-03-20

### Fixed
- Composer: restore fixed paste delay to fix image not recognized when sent with text

## [0.8.11] - 2026-03-20

### Fixed
- PTY: debounce output gate so submit key is sent after CLI finishes rendering, not on first output chunk
- Keyboard: auto-focus first worktree after adding a new project via Cmd+O
- Keyboard: auto-focus and zoom to new terminal after Cmd+T
- Keyboard: preserve worktree focus after closing the last terminal with Cmd+D
- Composer: forward backspace to terminal when input is empty

## [0.8.10] - 2026-03-19

### Fixed
- Terminal: fix scroll snapping back to bottom during AI thinking/streaming when user scrolls up

## [0.8.9] - 2026-03-19

### Fixed
- Composer: replace fixed paste delay with output-gated submit to prevent Enter from being swallowed

## [0.8.8] - 2026-03-19

### Fixed
- Keyboard: auto-focus first worktree after adding a new project via Cmd+O
- Keyboard: auto-focus and zoom to new terminal after Cmd+T
- Keyboard: preserve worktree focus after closing the last terminal with Cmd+D

## [0.8.7] - 2026-03-19

### Fixed
- Hydra: use resultFile as primary completion signal instead of relying solely on terminal status
- Hydra: distinguish explicit permission prompts from idle prompts to prevent false stall detection

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
