# Session Panel Tree Redesign

## Problem

The right sidebar session panel currently groups terminals by status
(Focused / Needs Attention / In Progress / Fresh Results / Background).
When multiple projects and worktrees are active, users must read the
`locationLabel` on each card to identify which project a terminal belongs to.
This is low information density and high cognitive load.

## Solution

Reorganize the panel as a collapsible tree: **Project → Worktree → Terminal**.
Status is expressed inline via color-coded dots and aggregated badge counts on
collapsed parent rows, preserving the "at a glance" awareness of the current
flat layout.

## Data Model

### New types (sessionPanelModel.ts)

```typescript
interface StatusSummary {
  attention: number;
  running: number;   // includes running + thinking
  done: number;
  idle: number;
}

interface WorktreeGroup {
  worktreeId: string;
  worktreeName: string;
  collapsed: boolean;
  statusSummary: StatusSummary;
  terminals: CanvasTerminalItem[];  // sorted by status priority → activityAt
}

interface ProjectGroup {
  projectId: string;
  projectName: string;
  collapsed: boolean;
  statusSummary: StatusSummary;
  worktrees: WorktreeGroup[];
  flat: boolean;  // true when project has only one worktree → skip worktree row
}
```

### New builder function

`buildProjectTree(projects, telemetryByTerminalId, sessionsById): ProjectGroup[]`

- Reuses existing `deriveTerminalState` logic for each terminal
- Groups terminals under their project/worktree
- Computes `StatusSummary` per worktree and per project
- Sorts projects by highest-priority status (attention first), then by name
- Sorts terminals within each worktree: attention → running → thinking → done → idle, then by activityAt desc
- Sets `flat: true` when a project has exactly one worktree

### Preserved functions

- `buildCanvasTerminalSections` stays — Inspector and focused-terminal logic still depend on it
- `buildCanvasTerminalDisplayGroups` can be removed once the new tree is in place

## UI Components

```
SessionsPanel (modified)
├─ Focused Section (unchanged, top)
│  └─ TerminalCard
├─ ProjectTree (new, scrollable)
│  ├─ ProjectRow (collapsible)
│  │  ├─ chevron + project name + StatusBadges (right-aligned)
│  │  └─ WorktreeRow (collapsible, hidden when flat)
│  │     ├─ chevron + worktree name + StatusBadges
│  │     └─ TerminalCard (compact, no locationLabel)
│  └─ ProjectRow ...
└─ Inspector (unchanged, bottom)
```

### ProjectRow
- Left: expand/collapse chevron (▸/▾) + project name (11px, medium weight)
- Right: StatusBadges — small colored dots with count, only shown for non-zero counts
- Example: `myproject  🔴1 🟡2`
- Click toggles collapse

### WorktreeRow
- Indented one level (pl-4)
- Same layout as ProjectRow but smaller (10px)
- Hidden when project.flat is true

### TerminalCard (modified)
- Indented two levels (pl-6, or pl-4 when flat)
- Remove locationLabel from subtitle (redundant with tree hierarchy)
- Keep status dot, title, activity text, age

### StatusBadges (new micro-component)
- Renders `[dot][count]` pairs for non-zero status counts
- Colors match existing STATUS_COLORS
- Visible even when parent is collapsed → key for at-a-glance awareness

## Interaction

- Click terminal card → `panToTerminal` (unchanged)
- Click project/worktree row → toggle collapse
- Hover terminal card → Inspector shows details (unchanged)
- Collapse state stored in a dedicated `useSessionPanelCollapseStore` (zustand), independent of canvas collapse state
- Projects with attention terminals sort to top
- Fresh Results handling: done terminals that haven't been "seen" get a brighter dot color or pulse animation instead of a separate section

## Scope

### In scope
- New `buildProjectTree` function in sessionPanelModel.ts
- New `ProjectTree`, `ProjectRow`, `WorktreeRow`, `StatusBadges` components
- New `useSessionPanelCollapseStore` for panel-specific collapse state
- Modify `SessionsPanel` to use tree view
- Modify `TerminalCard` to optionally hide locationLabel

### Out of scope
- Canvas layout changes
- Inspector redesign
- Session replay changes
- i18n for new section headers (use project/worktree names directly)
