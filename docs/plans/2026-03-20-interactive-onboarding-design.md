# Interactive Onboarding Tutorial Design

## Overview

Transform the existing single-page WelcomePopup into a multi-step interactive onboarding tutorial. The first page retains the existing text content; pressing Enter transitions into an interactive mini canvas where users learn core shortcuts hands-on.

## Approach

Single component state machine inside WelcomePopup. No new stores, no real Canvas embedding. The mini canvas is a set of styled divs with CSS transform for zoom/pan simulation.

## State Machine

```
step 0: Text page (existing WelcomePopup content unchanged)
        Press Enter → step 1
        Press Escape → close (skip tutorial)

step 1: Focus tutorial
        Mini canvas shows 4 unfocused terminal blocks in 2×2 grid
        Prompt: "Press Cmd+E to focus a terminal"
        User presses Cmd+E → first terminal gets blue glow → auto-advance to step 2

step 2: Switch tutorial
        Prompt: "Press Cmd+] to switch to next terminal"
        User presses Cmd+] or Cmd+[ → focus moves between terminals
        After 2 switches → show "Press Enter to continue" → step 3

step 3: Zoom/Pan tutorial
        Prompt: "Scroll to zoom, drag to pan"
        User scrolls or drags on mini canvas → canvas responds with CSS transform
        After any operation → show "Press Enter to continue" → step 4

step 4: Complete
        "Ready! Press Cmd+O to add your first project"
        Press Enter or Escape → close popup, write localStorage
```

## Mini Canvas Layout

```
┌─────────────────────────────────────────┐
│  welcome · termcanvas              [×]  │  ← reuse existing title bar
├─────────────────────────────────────────┤
│                                         │
│  ┌───────┐  ┌───────┐                   │
│  │ node  │  │ build │                   │
│  │ ...   │  │ ...   │                   │
│  └───────┘  └───────┘                   │  ← mini canvas area
│  ┌───────┐  ┌───────┐                   │     supports zoom/pan in step 3
│  │ git   │  │ test  │                   │
│  │ ...   │  │ ...   │                   │
│  └───────┘  └───────┘                   │
│                                         │
├─────────────────────────────────────────┤
│  Press Cmd+E to focus a terminal        │  ← prompt area
│  按 Cmd+E 聚焦终端                        │     bilingual via Bi component
└─────────────────────────────────────────┘
```

### Fake Terminals

- 4 blocks in a 2×2 grid: "node", "build", "git", "test"
- Each has a title bar (name + status color dot) and a few lines of static colored text simulating terminal output
- Focused state: blue glow border matching real TerminalTile style (rgba(0,112,243,0.45))

## Event Handling

### Shortcut Capture

- During tutorial (step 1-3), capture keyboard events on the popup div with `stopPropagation` + `preventDefault` to prevent Cmd+E/]/[ from reaching the real App
- Only respond to keys relevant to the current step; ignore others

### Step 3: Zoom/Pan

- Canvas area uses `transform: translate(x, y) scale(s)`
- `onWheel` adjusts scale (clamped 0.5–2.0)
- `onMouseDown` + `onMouseMove` for drag panning
- Initial transform centers the 4 terminals

### Step Advancement Conditions

- Step 1: Cmd+E detected → advance
- Step 2: cumulative switch count ≥ 2 → show "Press Enter to continue"
- Step 3: any zoom or pan detected → show "Press Enter to continue"
- Escape at any step → close popup (skip)

## i18n

New prompt strings added to `en.ts` and `zh.ts` for each step. Reuse existing `Bi` component for bilingual display.

## localStorage

Regardless of which step the user closes from (skip or complete), write `termcanvas-welcome-seen` to localStorage.
