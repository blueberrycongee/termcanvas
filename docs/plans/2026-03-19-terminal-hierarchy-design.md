# Terminal Parent-Child Hierarchy Visualization

## Problem

When Hydra spawns sub-agents, each child runs in its own terminal in a separate git worktree. There is no visual indication of which terminal spawned which — the parent-child relationship is invisible.

## Design

### Phase 1: Data Model

- Add `parentTerminalId?: string` to `TerminalData`
- Inject `TERMCANVAS_TERMINAL_ID` env var into every terminal's PTY process so Hydra can read it
- Update `POST /terminal/create` API to accept optional `parentTerminalId`
- Hydra reads `TERMCANVAS_TERMINAL_ID` from env and passes it as `--parent-terminal` to the API
- Add `getChildTerminals(terminalId)` and `getParentTerminal(terminalId)` selectors to projectStore

### Phase 2: Visual Connection Lines

- SVG `ConnectionOverlay` component rendered inside `#canvas-layer` (inherits viewport transform)
- For each parent-child pair, draw a bezier curve from parent tile center-bottom to child tile center-top
- Line style: 1.5px stroke, parent terminal type color at 30% opacity
- Arrow indicator at child end
- On hover: highlight all connections for the hovered terminal (opacity → 80%, glow filter)
- Lines recalculate from live DOM positions via `getBoundingClientRect()` + inverse viewport transform

### Phase 3: Terminal Badges

- Child terminals: show "↑ parentName" badge in title bar, tooltip with parent info, click to pan
- Parent terminals: show child count badge (e.g., "3 agents"), click to pan to first child
- Pan uses `canvasStore.animateTo()` to smoothly center target terminal

### Phase 4: Hover-to-Reveal Family Tree

- After 500ms hover on any terminal with connections, show floating overlay
- Displays parent → children tree with status indicators
- Each item clickable to pan canvas to that terminal
- Portal to `#canvas-layer` for correct positioning

## Key Decision

Parent terminal ID propagation via `TERMCANVAS_TERMINAL_ID` environment variable:
- TermCanvas injects this env var when spawning each terminal's PTY
- Hydra reads `process.env.TERMCANVAS_TERMINAL_ID` and passes it through the API
- Most reliable approach — no guessing or inference needed
