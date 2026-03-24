# Hub Navigation + Auto-Collapse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the sidebar with a capsule-shaped Hub for layered focus navigation, and auto-collapse worktrees with no terminals.

**Architecture:** Add a `focusLevel` state to canvasStore (terminal / starred / worktree). The Hub component reads this state and renders a capsule showing the current level and target. Existing Cmd+[] shortcuts switch targets within the current level. A new shortcut cycles levels. Auto-collapse is triggered in `removeTerminal` when a worktree's terminal count drops to 0.

**Tech Stack:** React, Zustand, TypeScript, Tailwind CSS

---

### Task 1: Add focus level state to canvasStore

**Files:**
- Modify: `src/stores/canvasStore.ts`

**Step 1: Add FocusLevel type and state**

Add to `src/stores/canvasStore.ts`:

```typescript
// After the imports, add:
export type FocusLevel = "terminal" | "starred" | "worktree";

// Add to CanvasStore interface:
focusLevel: FocusLevel;
setFocusLevel: (level: FocusLevel) => void;
cycleFocusLevel: () => void;

// Add to initial state:
focusLevel: "terminal" as FocusLevel,

// Add methods:
setFocusLevel: (level) => set({ focusLevel: level }),
cycleFocusLevel: () => {
  const order: FocusLevel[] = ["terminal", "starred", "worktree"];
  const current = get().focusLevel;
  const next = order[(order.indexOf(current) + 1) % order.length];
  set({ focusLevel: next });
},
```

**Step 2: Remove sidebar state**

Remove from `CanvasStore` interface and implementation:
- `sidebarCollapsed: boolean`
- `setSidebarCollapsed: (collapsed: boolean) => void`
- Initial value `sidebarCollapsed: false`
- Method `setSidebarCollapsed`
- The `sidebarCollapsed: true` line inside `animateTo` (line 68) — change to just `set({ isAnimating: true })`

Keep `SIDEBAR_WIDTH` constant removal for Task 5 (it may be referenced elsewhere).

**Step 3: Commit**

```bash
git add src/stores/canvasStore.ts
git commit -m "feat: add focusLevel state, remove sidebar state from canvasStore"
```

---

### Task 2: Add worktree focus order utility

**Files:**
- Modify: `src/stores/projectFocus.ts`
- Create: `tests/worktree-focus-order.test.ts`

**Step 1: Write the failing test**

Create `tests/worktree-focus-order.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { getWorktreeFocusOrder } from "../src/stores/projectFocus.ts";
import type { ProjectData } from "../src/types/index.ts";

test("getWorktreeFocusOrder returns all worktrees in project/worktree order", () => {
  const projects: ProjectData[] = [
    {
      id: "project-1",
      name: "Project 1",
      path: "/tmp/project-1",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 1,
      worktrees: [
        {
          id: "wt-1",
          name: "main",
          path: "/tmp/project-1",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [],
        },
        {
          id: "wt-2",
          name: "feature",
          path: "/tmp/project-1-feature",
          position: { x: 0, y: 200 },
          collapsed: false,
          terminals: [],
        },
      ],
    },
    {
      id: "project-2",
      name: "Project 2",
      path: "/tmp/project-2",
      position: { x: 500, y: 0 },
      collapsed: false,
      zIndex: 2,
      worktrees: [
        {
          id: "wt-3",
          name: "main",
          path: "/tmp/project-2",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [],
        },
      ],
    },
  ];

  assert.deepEqual(
    getWorktreeFocusOrder(projects).map((w) => w.worktreeId),
    ["wt-1", "wt-2", "wt-3"],
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/worktree-focus-order.test.ts`
Expected: FAIL — `getWorktreeFocusOrder` does not exist

**Step 3: Write the implementation**

Add to `src/stores/projectFocus.ts`:

```typescript
export interface WorktreeFocusOrderItem {
  projectId: string;
  worktreeId: string;
  index: number;
}

export function getWorktreeFocusOrder(
  projects: ProjectData[],
): WorktreeFocusOrderItem[] {
  const worktrees: Omit<WorktreeFocusOrderItem, "index">[] = [];

  for (const project of projects) {
    for (const worktree of project.worktrees) {
      worktrees.push({
        projectId: project.id,
        worktreeId: worktree.id,
      });
    }
  }

  return worktrees.map((w, index) => ({ ...w, index }));
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/worktree-focus-order.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/projectFocus.ts tests/worktree-focus-order.test.ts
git commit -m "feat: add getWorktreeFocusOrder utility"
```

---

### Task 3: Add panToWorktree utility

**Files:**
- Create: `src/utils/panToWorktree.ts`

**Step 1: Create panToWorktree**

Create `src/utils/panToWorktree.ts`:

```typescript
import { useProjectStore } from "../stores/projectStore";
import { useCanvasStore, RIGHT_PANEL_WIDTH, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import {
  computeWorktreeSize,
  PROJ_PAD,
  PROJ_TITLE_H,
} from "../layout";

/**
 * Animate the canvas viewport to center on the given worktree.
 */
export function panToWorktree(projectId: string, worktreeId: string): void {
  const { projects } = useProjectStore.getState();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  const worktree = project.worktrees.find((w) => w.id === worktreeId);
  if (!worktree) return;

  const size = computeWorktreeSize(worktree.terminals.map((t) => t.span));

  const absX = project.position.x + PROJ_PAD + worktree.position.x;
  const absY = project.position.y + PROJ_TITLE_H + PROJ_PAD + worktree.position.y;

  const { rightPanelCollapsed } = useCanvasStore.getState();
  const rightOffset = rightPanelCollapsed ? COLLAPSED_TAB_WIDTH : RIGHT_PANEL_WIDTH;
  const padding = 60;
  const viewW = window.innerWidth - rightOffset - padding * 2;
  const viewH = window.innerHeight - padding * 2;
  const scale = Math.min(viewW / size.w, viewH / size.h) * 0.85;

  const centerX = -(absX + size.w / 2) * scale + (window.innerWidth - rightOffset) / 2;
  const centerY = -(absY + size.h / 2) * scale + window.innerHeight / 2;

  useCanvasStore.getState().animateTo(centerX, centerY, scale);
}
```

**Step 2: Commit**

```bash
git add src/utils/panToWorktree.ts
git commit -m "feat: add panToWorktree utility"
```

---

### Task 4: Wire up layered focus switching in keyboard shortcuts

**Files:**
- Modify: `src/stores/shortcutStore.ts`
- Modify: `src/hooks/useKeyboardShortcuts.ts`

**Step 1: Add cycleFocusLevel shortcut**

In `src/stores/shortcutStore.ts`, add to `ShortcutMap` interface:

```typescript
cycleFocusLevel: string;
```

Add to `DEFAULT_SHORTCUTS`:

```typescript
cycleFocusLevel: "mod+g",
```

**Step 2: Refactor focus switching to be level-aware**

In `src/hooks/useKeyboardShortcuts.ts`:

Add imports:
```typescript
import { getWorktreeFocusOrder } from "../stores/projectFocus";
import { panToWorktree } from "../utils/panToWorktree";
```

Add a helper function after the existing helpers:

```typescript
function getAllWorktrees() {
  const { projects } = useProjectStore.getState();
  return getWorktreeFocusOrder(projects);
}

function getFocusedWorktreeIndex(
  list: { projectId: string; worktreeId: string }[],
) {
  const { focusedWorktreeId } = useProjectStore.getState();
  if (!focusedWorktreeId) return -1;
  return list.findIndex((item) => item.worktreeId === focusedWorktreeId);
}
```

**Step 3: Add cycleFocusLevel handler**

In the keydown handler, add before the existing `nextTerminal` handler:

```typescript
if (matchesShortcut(e, shortcuts.cycleFocusLevel)) {
  e.preventDefault();
  useCanvasStore.getState().cycleFocusLevel();
  return;
}
```

**Step 4: Make next/prev shortcuts level-aware**

Replace the `nextTerminal` handler (lines 460-471) with:

```typescript
if (matchesShortcut(e, shortcuts.nextTerminal)) {
  e.preventDefault();
  const level = useCanvasStore.getState().focusLevel;

  if (level === "worktree") {
    const list = getAllWorktrees();
    if (list.length === 0) return;
    const currentIndex = getFocusedWorktreeIndex(list);
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + 1) % list.length;
    const next = list[nextIndex];
    useProjectStore.getState().setFocusedWorktree(next.projectId, next.worktreeId);
    panToWorktree(next.projectId, next.worktreeId);
    return;
  }

  const terminalList =
    level === "starred" ? getStarredTerminals() : getAllTerminals();
  if (terminalList.length === 0) return;
  const currentIndex = getFocusedTerminalIndex(terminalList);
  const nextIndex =
    currentIndex === -1 ? 0 : (currentIndex + 1) % terminalList.length;
  const next = terminalList[nextIndex];
  useProjectStore.getState().setFocusedTerminal(next.terminalId);
  zoomToTerminal(next.projectId, next.worktreeId, next.terminalId);
  return;
}
```

Replace the `prevTerminal` handler (lines 473-484) with the same logic but decrementing index.

**Step 5: Remove the separate starred handlers**

Remove the `nextStarred` (lines 486-497) and `prevStarred` (lines 499-510) handlers — their functionality is now covered by `focusLevel === "starred"` + `nextTerminal`/`prevTerminal`.

**Step 6: Remove toggleSidebar handler**

Remove the `mod+b` / `toggleSidebar` handler (lines 295-300).

**Step 7: Remove sidebar-related shortcut definitions**

In `src/stores/shortcutStore.ts`:
- Remove `toggleSidebar` from `ShortcutMap` interface
- Remove `toggleSidebar` from `DEFAULT_SHORTCUTS`
- Remove `nextStarred` and `prevStarred` from `ShortcutMap` interface
- Remove `nextStarred` and `prevStarred` from `DEFAULT_SHORTCUTS`

**Step 8: Commit**

```bash
git add src/stores/shortcutStore.ts src/hooks/useKeyboardShortcuts.ts
git commit -m "feat: wire up layered focus switching via focusLevel"
```

---

### Task 5: Remove Sidebar component

**Files:**
- Delete: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/stores/canvasStore.ts`
- Modify: `src/components/ShortcutHints.tsx`

**Step 1: Remove Sidebar from App.tsx**

Remove the Sidebar import and `<Sidebar />` render from `App.tsx`.

**Step 2: Remove SIDEBAR_WIDTH constant**

In `src/stores/canvasStore.ts`, remove the `SIDEBAR_WIDTH` constant (line 6). Search for any other imports of `SIDEBAR_WIDTH` and remove them.

**Step 3: Update ShortcutHints**

In `src/components/ShortcutHints.tsx`, remove the `toggleSidebar`, `nextStarred`, and `prevStarred` hints. Add `cycleFocusLevel` hint with description matching i18n.

**Step 4: Delete Sidebar.tsx**

Delete `src/components/Sidebar.tsx`.

**Step 5: Fix any remaining references**

Search for any remaining imports/references to `Sidebar`, `sidebarCollapsed`, `setSidebarCollapsed`, or `SIDEBAR_WIDTH` and remove them.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove Sidebar component and related state"
```

---

### Task 6: Auto-collapse worktrees with no terminals

**Files:**
- Modify: `src/stores/projectStore.ts`

**Step 1: Add auto-collapse logic in removeTerminal**

In `src/stores/projectStore.ts`, in the `removeTerminal` method (line 449), after filtering the terminal out, check if the worktree has 0 terminals remaining and set `collapsed: true`:

Replace the worktree mapping inside `removeTerminal` (lines 477-485):

```typescript
worktrees: p.worktrees.map((w) =>
  w.id !== worktreeId
    ? w
    : {
        ...w,
        terminals: w.terminals.filter(
          (t) => t.id !== terminalId,
        ),
        // Auto-collapse when last terminal is removed
        collapsed:
          w.terminals.filter((t) => t.id !== terminalId)
            .length === 0
            ? true
            : w.collapsed,
      },
),
```

**Step 2: Ensure syncWorktrees creates collapsed worktrees**

Find the `syncWorktrees` method in projectStore and ensure new worktrees are created with `collapsed: true` (they have no terminals initially). Check the current default — if it's already `collapsed: false`, change it to `true`.

**Step 3: Commit**

```bash
git add src/stores/projectStore.ts
git commit -m "feat: auto-collapse worktrees when last terminal is removed"
```

---

### Task 7: Create Hub component

**Files:**
- Create: `src/components/Hub.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

**Step 1: Create Hub component**

Create `src/components/Hub.tsx`:

```tsx
import { useCanvasStore, type FocusLevel } from "../stores/canvasStore";
import { useProjectStore } from "../stores/projectStore";
import { useShortcutStore, formatShortcut } from "../stores/shortcutStore";
import { getWorktreeFocusOrder } from "../stores/projectFocus";
import { getTerminalFocusOrder } from "../stores/projectFocus";
import { panToWorktree } from "../utils/panToWorktree";
import { useTranslation } from "../i18n";
import { useState, useCallback, useEffect, useRef } from "react";

const LEVEL_ICONS: Record<FocusLevel, string> = {
  terminal: "▣",
  starred: "★",
  worktree: "⌥",
};

interface FocusTarget {
  id: string;
  label: string;
  projectId: string;
  worktreeId: string;
  terminalId?: string;
}

export function Hub() {
  const { focusLevel, cycleFocusLevel } = useCanvasStore();
  const { projects, focusedWorktreeId, setFocusedTerminal, setFocusedWorktree } =
    useProjectStore();
  const { shortcuts } = useShortcutStore();
  const t = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build target list based on current level
  const targets: FocusTarget[] = (() => {
    if (focusLevel === "worktree") {
      return getWorktreeFocusOrder(projects).map((item) => {
        const project = projects.find((p) => p.id === item.projectId);
        const worktree = project?.worktrees.find(
          (w) => w.id === item.worktreeId,
        );
        return {
          id: item.worktreeId,
          label: `${project?.name ?? "?"} / ${worktree?.name ?? "?"}`,
          projectId: item.projectId,
          worktreeId: item.worktreeId,
        };
      });
    }

    const terminalItems =
      focusLevel === "starred"
        ? getTerminalFocusOrder(projects).filter((item) => {
            const project = projects.find((p) => p.id === item.projectId);
            const worktree = project?.worktrees.find(
              (w) => w.id === item.worktreeId,
            );
            return worktree?.terminals.find(
              (t) => t.id === item.terminalId,
            )?.starred;
          })
        : getTerminalFocusOrder(projects);

    return terminalItems.map((item) => {
      const project = projects.find((p) => p.id === item.projectId);
      const worktree = project?.worktrees.find(
        (w) => w.id === item.worktreeId,
      );
      const terminal = worktree?.terminals.find(
        (t) => t.id === item.terminalId,
      );
      return {
        id: item.terminalId,
        label: terminal?.customTitle || terminal?.title || "?",
        projectId: item.projectId,
        worktreeId: item.worktreeId,
        terminalId: item.terminalId,
      };
    });
  })();

  // Find current target name
  const currentTarget = (() => {
    if (focusLevel === "worktree") {
      const wt = targets.find((t) => t.worktreeId === focusedWorktreeId);
      return wt?.label ?? t("hub.none");
    }
    const focused = projects
      .flatMap((p) => p.worktrees.flatMap((w) => w.terminals))
      .find((t) => t.focused);
    if (!focused) return t("hub.none");
    return focused.customTitle || focused.title;
  })();

  const selectTarget = useCallback(
    (target: FocusTarget) => {
      setExpanded(false);
      if (target.terminalId) {
        setFocusedTerminal(target.terminalId);
      } else {
        setFocusedWorktree(target.projectId, target.worktreeId);
        panToWorktree(target.projectId, target.worktreeId);
      }
    },
    [setFocusedTerminal, setFocusedWorktree],
  );

  // Keyboard navigation when expanded
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, targets.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (targets[selectedIndex]) selectTarget(targets[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [expanded, selectedIndex, targets, selectTarget]);

  // Reset selected index when expanded or level changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [expanded, focusLevel]);

  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform?.startsWith("Mac");
  const levelShortcut = formatShortcut(shortcuts.cycleFocusLevel, !!isMac);
  const levelLabel = t(`hub.level.${focusLevel}`);

  return (
    <div
      ref={containerRef}
      className="fixed top-2 left-2 z-50 select-none"
    >
      {/* Capsule */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
          bg-bg-secondary/90 backdrop-blur border border-border-primary
          text-text-primary text-xs font-medium
          hover:bg-bg-tertiary transition-colors cursor-pointer"
        title={`${levelLabel} (${levelShortcut})`}
      >
        <span className="text-text-muted">{LEVEL_ICONS[focusLevel]}</span>
        <span className="max-w-[200px] truncate">{currentTarget}</span>
      </button>

      {/* Expanded list */}
      {expanded && (
        <div
          className="mt-1 rounded-lg bg-bg-secondary/95 backdrop-blur
            border border-border-primary shadow-lg
            max-h-[300px] overflow-y-auto min-w-[200px]"
        >
          {/* Level indicator */}
          <div className="px-3 py-1.5 text-[10px] text-text-muted uppercase tracking-wider border-b border-border-primary flex items-center justify-between">
            <span>{levelLabel}</span>
            <span className="text-text-muted/50">{levelShortcut}</span>
          </div>

          {targets.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted">
              {t("hub.empty")}
            </div>
          ) : (
            targets.map((target, i) => (
              <button
                key={target.id}
                onClick={() => selectTarget(target)}
                className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer
                  hover:bg-bg-tertiary transition-colors truncate
                  ${i === selectedIndex ? "bg-bg-tertiary text-text-primary" : "text-text-secondary"}`}
              >
                {target.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add i18n keys**

In `src/i18n/en.ts`, add:
```typescript
"hub.none": "No focus",
"hub.empty": "No targets",
"hub.level.terminal": "Terminal",
"hub.level.starred": "Starred",
"hub.level.worktree": "Worktree",
```

In `src/i18n/zh.ts`, add:
```typescript
"hub.none": "无焦点",
"hub.empty": "无目标",
"hub.level.terminal": "终端",
"hub.level.starred": "收藏",
"hub.level.worktree": "工作树",
```

**Step 3: Mount Hub in App.tsx**

In `src/App.tsx`, replace the removed `<Sidebar />` with `<Hub />`:

```tsx
import { Hub } from "./components/Hub";
// ... in render:
<Hub />
```

**Step 4: Commit**

```bash
git add src/components/Hub.tsx src/App.tsx src/i18n/en.ts src/i18n/zh.ts
git commit -m "feat: add Hub component for layered focus navigation"
```

---

### Task 8: Click-outside to close Hub + visual polish

**Files:**
- Modify: `src/components/Hub.tsx`

**Step 1: Add click-outside handler**

Add a `useEffect` in the Hub component to listen for clicks outside `containerRef` and call `setExpanded(false)`.

```typescript
useEffect(() => {
  if (!expanded) return;
  const handler = (e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setExpanded(false);
    }
  };
  window.addEventListener("mousedown", handler);
  return () => window.removeEventListener("mousedown", handler);
}, [expanded]);
```

**Step 2: Scroll selected item into view**

Add a ref to each list item and scroll into view when `selectedIndex` changes.

**Step 3: Commit**

```bash
git add src/components/Hub.tsx
git commit -m "fix: add click-outside close and scroll-into-view for Hub"
```

---

### Task 9: Update tests and clean up

**Files:**
- Modify: `tests/shortcut-behavior.test.ts`
- Modify: `src/components/ShortcutHints.tsx`

**Step 1: Update shortcut tests**

In `tests/shortcut-behavior.test.ts`:
- Remove any references to `toggleSidebar` shortcut
- Remove any references to `nextStarred`/`prevStarred` shortcuts
- Add test for `cycleFocusLevel` shortcut matching

**Step 2: Update ShortcutHints**

In `src/components/ShortcutHints.tsx`:
- Remove `toggleSidebar`, `nextStarred`, `prevStarred` entries
- Add `cycleFocusLevel` entry with appropriate label

**Step 3: Run all tests**

Run: `npx tsx --test tests/*.test.ts`
Expected: All pass

**Step 4: Commit**

```bash
git add tests/shortcut-behavior.test.ts src/components/ShortcutHints.tsx
git commit -m "test: update shortcut tests and hints for Hub navigation"
```

---

### Task 10: Build verification

**Step 1: Run build**

Run: `npm run build`
Expected: Build succeeds with no type errors

**Step 2: Manual smoke test**

- Open app, verify Hub capsule shows in top-left
- Press `Cmd+G` to cycle focus levels (Terminal → Starred → Worktree)
- Press `Cmd+]` / `Cmd+[` at each level to verify switching works
- Click Hub to expand, verify list shows correct targets
- Verify arrow keys + enter navigation in expanded Hub
- Verify clicking outside closes Hub
- Close all terminals in a worktree, verify it auto-collapses
- Navigate to collapsed worktree, press `Cmd+T`, verify terminal is created
- Verify sidebar is fully removed

**Step 3: Commit any fixes**

If any issues found, fix and commit.
