# Welcome Demo Animation Design

Replace the existing interactive WelcomePopup tutorial with an auto-playing animation demo that showcases TermCanvas features. Inspired by [Agentation's hero demo](https://www.agentation.com/) architecture.

## Requirements

- Auto-playing animation, not interactive tutorial
- Shows on first launch; replayable via button
- Demonstrates: focus, terminal switching, zoom/pan, right panel (Usage + Hydra)
- Keystroke bar at bottom synced with current animation step
- Simplified placeholder UI (not realistic rendering)
- Single playthrough, stops on last frame with Replay button

## Architecture

Single async/await timeline (same pattern as Agentation's HeroDemo.tsx):
- One `runAnimation()` async function drives all steps sequentially
- ~15 useState variables control UI element visibility/position
- CSS transitions handle visual interpolation
- `if (cancelled) return` guard before each step for safe teardown

## Simulated UI Layout

```
┌─────────────────────────────────────────────────┐
│  TermCanvas Demo                            [×] │
├────┬────────────────────────────────┬───────────┤
│    │                                │           │
│ S  │         Canvas Area            │  Right    │
│ I  │   ┌──────┐  ┌──────┐          │  Panel    │
│ D  │   │ node │  │build │          │           │
│ E  │   └──────┘  └──────┘          │           │
│ B  │   ┌──────┐  ┌──────┐          │           │
│ A  │   │ git  │  │ test │          │           │
│ R  │   └──────┘  └──────┘          │           │
│    │                                │           │
│    ├────────────────────────────────┤           │
│    │  ⌘ E  ·  Toggle Focus · 聚焦   │           │
└────┴────────────────────────────────┴───────────┘
```

- **Popup**: max-width 800px, centered modal with backdrop
- **Sidebar**: ~44px, colored bars + project name placeholders
- **Canvas**: dark bg with dot grid, 4 terminal tiles (2×2)
- **Right Panel**: initially hidden, slides in from right (~180px)
- **Keystroke Bar**: bottom of canvas area, shows current shortcut + bilingual label

## Animation Script (~20s total)

| # | Phase | Duration | Animation | Keystroke Bar |
|---|-------|----------|-----------|---------------|
| 1 | Intro | 2s | Fade in, tiles stagger in, cursor appears at center | — |
| 2 | Focus | 3s | Cursor → node tile, tile glows blue, canvas zooms in | `⌘ E · Toggle Focus · 切换聚焦` |
| 3 | Switch | 4s | Focus jumps: build → git → test with pauses | `⌘ ] · Next Terminal · 下一终端` |
| 4 | Unfocus | 2s | Focus released, canvas zooms back to overview | `⌘ E · Toggle Focus · 切换聚焦` |
| 5 | Zoom/Pan | 3s | Scroll zoom out → drag pan → zoom back | `Scroll · Zoom` / `Drag · Pan` |
| 6 | Panel | 4s | Panel slides in, shows Usage placeholders, switches to Hydra | `⌘ / · Toggle Panel · 切换面板` |
| 7 | Finish | 2s | Panel closes, elements reset, stop on final frame | `⌘ O · Add Project · 添加项目` |

Last frame holds. Replay button appears below.

## Visual Details

### Cursor
- SVG arrow, absolute positioned
- Movement: `transition: left 350ms cubic-bezier(0.4, 0, 0.2, 1), top 350ms ...`
- Drag mode: transition disabled, position updated per-frame via for loop + delay(25)
- `filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3))`

### Keystroke Bar
- Semi-transparent background bar at canvas bottom
- Key shown as pill badge (monospace, `var(--bg)` bg, rounded)
- Label in bilingual Bi style (cyan EN + amber ZH)
- Content switch: 150ms fade out/in (opacity + translateY)

### Focus Glow
- Reuses project visual language: `border-color: rgba(0,112,243,0.6)`, `box-shadow: 0 0 12px rgba(0,112,243,0.45)`
- 200ms ease-out transition

### Right Panel
- `transform: translateX(100%) → translateX(0)`, 300ms with SPRING_IN `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Interior: gray placeholder bars (token chart), number block (cost)

## Component Structure

All in `WelcomePopup.tsx` (self-contained, no new files):

```
WelcomePopup
├── DemoStage        — flex container (sidebar + canvas + panel)
│   ├── DemoSidebar  — project list placeholders
│   ├── DemoCanvas   — dot grid bg, terminal tiles, cursor
│   ├── DemoPanel    — right panel (usage/hydra placeholders)
│   └── DemoCursor   — SVG arrow cursor
├── KeystrokeBar     — bottom shortcut display
└── Controls         — Replay button + close hint
```

## State (~15 useState)

```
cursorPos, focusedTile, tilesVisible, canvasTransform,
panelVisible, panelContent, keystroke, isPlaying, isFinished
```

## Lifecycle

- **Trigger**: first launch (`!localStorage["termcanvas-welcome-seen"]`)
- **Escape / backdrop click / × button**: close + mark seen
- **Replay**: resets all state, re-runs animation
- **visibilitychange**: cancel on hidden, restart on visible
- **prefers-reduced-motion**: skip animation, show static final frame + shortcut list
- **Cleanup**: `cancelled = true` on unmount, all pending timeouts become no-ops

## Removed

- All interactive tutorial logic (steps 0-5, keyboard handlers, double-click, zoom/pan interaction)
- MiniCanvas component
- Tutorial-specific i18n strings (onboarding_dblclick_prompt, etc.)
