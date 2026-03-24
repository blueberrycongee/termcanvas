# Hub Navigation + Auto-Collapse Design

## Problem

When many branches/worktrees are open, the canvas becomes large and cluttered. Navigation relies on zooming and panning, which is inefficient. The sidebar provides a tree overview but takes up space and doesn't match the actual usage pattern — users focus on one terminal at a time and switch via shortcuts.

## Solution

Two changes:

1. **Auto-collapse empty worktrees** — worktrees with no terminals collapse automatically, reducing visual noise
2. **Replace sidebar with Hub** — a capsule-shaped layered focus navigator

## Hub Design

### Default State (Capsule)

A small capsule pinned to the top-left corner showing:
```
[Level Icon] Current Target Name
```

Minimal footprint, always visible.

### Focus Levels

One shortcut cycles through three levels:
- **Terminal**: switch targets = all terminals
- **Starred**: switch targets = starred terminals
- **Worktree**: switch targets = all worktrees

### Expanded State

Triggered by clicking the capsule or a shortcut:
- Shows a list of all targets at the current level
- Up/down arrow keys to navigate
- Enter to confirm and jump to target
- Auto-collapses after selection

### Target Switching

Existing Cmd+[] shortcuts switch between targets within the current level (same behavior as today, but target list varies by level).

## Auto-Collapse

- Worktrees with 0 terminals are automatically collapsed
- Focus state is unaffected — Cmd+T still creates a terminal in the focused worktree even if collapsed
- Newly added projects start with all worktrees collapsed
- Closing the last terminal in a worktree triggers auto-collapse

## Removals

- Remove sidebar component and its toggle shortcut
- Remove sidebar-related state from canvasStore
