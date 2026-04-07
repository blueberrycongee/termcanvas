# Session Panel Tree Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the right sidebar session panel from flat status-grouped layout to a collapsible Project → Worktree → Terminal tree with inline status indicators.

**Architecture:** Add a `buildProjectTree()` function to `sessionPanelModel.ts` that groups existing `CanvasTerminalItem`s into a `ProjectGroup[]` tree. A new `useSessionPanelCollapseStore` manages panel-specific collapse state. The `SessionsPanel` component renders the tree with `ProjectRow`, `WorktreeRow`, and `StatusBadges` sub-components. Existing `TerminalCard`, `Inspector`, and focused-terminal logic are preserved.

**Tech Stack:** TypeScript, React, Zustand, Tailwind-style utility classes (inline)

---

### Task 1: Add `buildProjectTree` to sessionPanelModel.ts

**Files:**
- Modify: `src/components/sessionPanelModel.ts`

**Step 1: Write the failing test**

Add to `tests/session-panel-model.test.ts`:

```typescript
import {
  buildCanvasTerminalDisplayGroups,
  buildCanvasTerminalSections,
  buildProjectTree,
  type ProjectGroup,
} from "../src/components/sessionPanelModel.ts";

// ... existing imports and helpers ...

test("buildProjectTree groups terminals under project/worktree with status summaries", () => {
  const telemetryByTerminalId = new Map<string, TerminalTelemetrySnapshot | null>([
    [
      "terminal-focused",
      createTelemetry("terminal-focused", {
        turn_state: "turn_complete",
        derived_status: "progressing",
        last_meaningful_progress_at: "2026-04-05T12:06:00.000Z",
      }),
    ],
    [
      "terminal-stalled",
      createTelemetry("terminal-stalled", {
        provider: "claude",
        turn_state: "in_turn",
        derived_status: "stall_candidate",
        last_meaningful_progress_at: "2026-04-05T12:04:00.000Z",
      }),
    ],
  ]);
  const sessionsById = new Map<string, SessionInfo>([
    [
      "session-running",
      createSession("session-running", "tool_running", "2026-04-05T12:05:00.000Z"),
    ],
    [
      "session-focused",
      createSession("session-focused", "turn_complete", "2026-04-05T12:06:00.000Z"),
    ],
  ]);

  const tree = buildProjectTree(createProjects(), telemetryByTerminalId, sessionsById);

  assert.equal(tree.length, 1);
  assert.equal(tree[0].projectName, "termcanvas");
  assert.equal(tree[0].flat, true); // single worktree
  assert.equal(tree[0].worktrees.length, 1);

  const wt = tree[0].worktrees[0];
  // focused terminal excluded, hidden terminal excluded
  // remaining: stalled (attention), running (running), idle (idle)
  assert.equal(wt.terminals.length, 3);
  // sorted by status priority: attention first
  assert.equal(wt.terminals[0].terminalId, "terminal-stalled");
  assert.equal(wt.terminals[0].state, "attention");
  assert.equal(wt.terminals[1].terminalId, "terminal-running");
  assert.equal(wt.terminals[2].terminalId, "terminal-idle");

  // status summary
  assert.equal(tree[0].statusSummary.attention, 1);
  assert.equal(tree[0].statusSummary.running, 1);
  assert.equal(tree[0].statusSummary.idle, 1);
});
```

**Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/session-panel-model.test.ts`
Expected: FAIL — `buildProjectTree` is not exported

**Step 3: Write the implementation**

Add to `src/components/sessionPanelModel.ts`:

```typescript
export interface StatusSummary {
  attention: number;
  running: number;
  done: number;
  idle: number;
}

export interface WorktreeGroup {
  worktreeId: string;
  worktreeName: string;
  statusSummary: StatusSummary;
  terminals: CanvasTerminalItem[];
}

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  statusSummary: StatusSummary;
  worktrees: WorktreeGroup[];
  flat: boolean;
}

const STATE_PRIORITY: Record<CanvasTerminalState, number> = {
  attention: 0,
  running: 1,
  thinking: 2,
  done: 3,
  idle: 4,
};

function computeStatusSummary(items: CanvasTerminalItem[]): StatusSummary {
  const summary: StatusSummary = { attention: 0, running: 0, done: 0, idle: 0 };
  for (const item of items) {
    switch (item.state) {
      case "attention": summary.attention++; break;
      case "running":
      case "thinking": summary.running++; break;
      case "done": summary.done++; break;
      default: summary.idle++; break;
    }
  }
  return summary;
}

function compareByStateThenActivity(a: CanvasTerminalItem, b: CanvasTerminalItem): number {
  const pa = STATE_PRIORITY[a.state];
  const pb = STATE_PRIORITY[b.state];
  if (pa !== pb) return pa - pb;
  return compareItemsByActivity(a, b);
}

function highestPriority(summary: StatusSummary): number {
  if (summary.attention > 0) return 0;
  if (summary.running > 0) return 1;
  if (summary.done > 0) return 3;
  return 4;
}

export function buildProjectTree(
  projects: ProjectData[],
  telemetryByTerminalId: Map<string, TerminalTelemetrySnapshot | null | undefined>,
  sessionsById: Map<string, SessionInfo>,
): ProjectGroup[] {
  const groups: ProjectGroup[] = [];

  for (const project of projects) {
    const worktreeGroups: WorktreeGroup[] = [];

    for (const worktree of project.worktrees) {
      const terminals: CanvasTerminalItem[] = [];

      for (const terminal of worktree.terminals) {
        const resolvedTerminal = resolveTerminalWithRuntimeState(terminal);

        if (!isCanvasTerminal(project.collapsed, worktree.collapsed, resolvedTerminal)) {
          continue;
        }
        if (resolvedTerminal.focused) continue;

        const telemetry = telemetryByTerminalId.get(resolvedTerminal.id);
        const session = resolvedTerminal.sessionId
          ? sessionsById.get(resolvedTerminal.sessionId)
          : undefined;
        const derived = deriveTerminalState(resolvedTerminal, telemetry, session);
        const title = resolveTerminalTitle(resolvedTerminal, worktree.name, project.name);
        const locationLabel =
          worktree.name === project.name ? worktree.name : `${project.name} / ${worktree.name}`;

        terminals.push({
          terminalId: resolvedTerminal.id,
          projectId: project.id,
          projectName: project.name,
          worktreeId: worktree.id,
          worktreeName: worktree.name,
          sessionId: resolvedTerminal.sessionId,
          sessionFilePath: derived.sessionFilePath,
          title,
          locationLabel,
          focused: false,
          state: derived.state,
          activityAt: derived.activityAt,
          currentTool: derived.currentTool,
        });
      }

      if (terminals.length === 0) continue;

      terminals.sort(compareByStateThenActivity);

      worktreeGroups.push({
        worktreeId: worktree.id,
        worktreeName: worktree.name,
        statusSummary: computeStatusSummary(terminals),
        terminals,
      });
    }

    if (worktreeGroups.length === 0) continue;

    const allTerminals = worktreeGroups.flatMap((wt) => wt.terminals);

    groups.push({
      projectId: project.id,
      projectName: project.name,
      statusSummary: computeStatusSummary(allTerminals),
      worktrees: worktreeGroups,
      flat: worktreeGroups.length === 1,
    });
  }

  groups.sort((a, b) => {
    const pa = highestPriority(a.statusSummary);
    const pb = highestPriority(b.statusSummary);
    if (pa !== pb) return pa - pb;
    return a.projectName.localeCompare(b.projectName);
  });

  return groups;
}
```

**Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/session-panel-model.test.ts`
Expected: All tests PASS

**Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/components/sessionPanelModel.ts tests/session-panel-model.test.ts
git commit -m "feat(sessions): add buildProjectTree for tree-based session panel"
```

---

### Task 2: Add multi-project test for buildProjectTree

**Files:**
- Modify: `tests/session-panel-model.test.ts`

**Step 1: Write the test**

```typescript
test("buildProjectTree sorts projects by highest-priority status and handles multiple worktrees", () => {
  const multiProjects: ProjectData[] = [
    {
      id: "project-idle",
      name: "idle-project",
      path: "/tmp/idle",
      position: { x: 0, y: 0 },
      collapsed: false,
      zIndex: 1,
      worktrees: [
        {
          id: "wt-idle",
          name: "main",
          path: "/tmp/idle",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "t-idle-1",
              title: "shell",
              type: "shell",
              minimized: false,
              focused: false,
              ptyId: 200,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
      ],
    },
    {
      id: "project-active",
      name: "active-project",
      path: "/tmp/active",
      position: { x: 100, y: 0 },
      collapsed: false,
      zIndex: 2,
      worktrees: [
        {
          id: "wt-main",
          name: "main",
          path: "/tmp/active",
          position: { x: 0, y: 0 },
          collapsed: false,
          terminals: [
            {
              id: "t-active-1",
              title: "claude",
              type: "claude",
              minimized: false,
              focused: false,
              ptyId: 201,
              status: "running",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
        {
          id: "wt-feature",
          name: "feature/new-ui",
          path: "/tmp/active-feature",
          position: { x: 0, y: 100 },
          collapsed: false,
          terminals: [
            {
              id: "t-active-2",
              title: "codex",
              type: "codex",
              minimized: false,
              focused: false,
              ptyId: 202,
              status: "idle",
              span: { cols: 1, rows: 1 },
            },
          ],
        },
      ],
    },
  ];

  const tree = buildProjectTree(
    multiProjects,
    new Map(),
    new Map(),
  );

  assert.equal(tree.length, 2);
  // active-project has running terminal → sorts first
  assert.equal(tree[0].projectName, "active-project");
  assert.equal(tree[0].flat, false); // two worktrees
  assert.equal(tree[0].worktrees.length, 2);
  assert.equal(tree[1].projectName, "idle-project");
  assert.equal(tree[1].flat, true);
});
```

**Step 2: Run test**

Run: `npx tsx --test tests/session-panel-model.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/session-panel-model.test.ts
git commit -m "test(sessions): add multi-project tree test"
```

---

### Task 3: Create useSessionPanelCollapseStore

**Files:**
- Create: `src/stores/sessionPanelCollapseStore.ts`

**Step 1: Write the store**

```typescript
import { create } from "zustand";

interface SessionPanelCollapseStore {
  collapsed: Set<string>;
  toggle: (id: string) => void;
  isCollapsed: (id: string) => boolean;
}

export const useSessionPanelCollapseStore = create<SessionPanelCollapseStore>(
  (set, get) => ({
    collapsed: new Set(),

    toggle: (id) =>
      set((state) => {
        const next = new Set(state.collapsed);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { collapsed: next };
      }),

    isCollapsed: (id) => get().collapsed.has(id),
  }),
);
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/stores/sessionPanelCollapseStore.ts
git commit -m "feat(sessions): add panel-specific collapse store"
```

---

### Task 4: Add StatusBadges component

**Files:**
- Create: `src/components/StatusBadges.tsx`

**Step 1: Write the component**

```typescript
import type { StatusSummary } from "./sessionPanelModel";

const BADGE_COLORS: { key: keyof StatusSummary; color: string }[] = [
  { key: "attention", color: "#ef4444" },
  { key: "running", color: "#f59e0b" },
  { key: "done", color: "#6b7280" },
  { key: "idle", color: "#94a3b8" },
];

export function StatusBadges({ summary }: { summary: StatusSummary }) {
  return (
    <div className="flex items-center gap-1.5">
      {BADGE_COLORS.map(
        ({ key, color }) =>
          summary[key] > 0 && (
            <span key={key} className="flex items-center gap-0.5">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: color }}
              />
              <span
                className="text-[9px] tabular-nums text-[var(--text-muted)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {summary[key]}
              </span>
            </span>
          ),
      )}
    </div>
  );
}
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/StatusBadges.tsx
git commit -m "feat(sessions): add StatusBadges component"
```

---

### Task 5: Add ProjectRow and WorktreeRow components

**Files:**
- Create: `src/components/ProjectTree.tsx`

**Step 1: Write the components**

```typescript
import { useSessionPanelCollapseStore } from "../stores/sessionPanelCollapseStore";
import { StatusBadges } from "./StatusBadges";
import type { ProjectGroup, WorktreeGroup, CanvasTerminalItem } from "./sessionPanelModel";
import type { useT } from "../i18n/useT";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      fill="currentColor"
    >
      <path d="M3 2l4 3-4 3z" />
    </svg>
  );
}

function WorktreeRow({
  group,
  renderTerminal,
}: {
  group: WorktreeGroup;
  renderTerminal: (item: CanvasTerminalItem) => React.ReactNode;
}) {
  const toggle = useSessionPanelCollapseStore((s) => s.toggle);
  const collapsed = useSessionPanelCollapseStore((s) => s.collapsed);
  const isCollapsed = collapsed.has(group.worktreeId);

  return (
    <div>
      <button
        className="w-full flex items-center gap-1 pl-4 pr-2 py-1 text-left cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors"
        onClick={() => toggle(group.worktreeId)}
      >
        <ChevronIcon open={!isCollapsed} />
        <span className="text-[10px] text-[var(--text-muted)] truncate flex-1">
          {group.worktreeName}
        </span>
        {isCollapsed && <StatusBadges summary={group.statusSummary} />}
      </button>
      {!isCollapsed && (
        <div className="flex flex-col gap-0.5 pl-4 pr-2 pb-1">
          {group.terminals.map(renderTerminal)}
        </div>
      )}
    </div>
  );
}

export function ProjectTree({
  projects,
  renderTerminal,
}: {
  projects: ProjectGroup[];
  renderTerminal: (item: CanvasTerminalItem) => React.ReactNode;
}) {
  const toggle = useSessionPanelCollapseStore((s) => s.toggle);
  const collapsed = useSessionPanelCollapseStore((s) => s.collapsed);

  if (projects.length === 0) return null;

  return (
    <div className="flex flex-col">
      {projects.map((project) => {
        const isCollapsed = collapsed.has(project.projectId);

        return (
          <div key={project.projectId} className="pt-1">
            <button
              className="w-full flex items-center gap-1 px-3 py-1 text-left cursor-pointer hover:bg-[var(--sidebar-hover)] transition-colors"
              onClick={() => toggle(project.projectId)}
            >
              <ChevronIcon open={!isCollapsed} />
              <span className="text-[11px] font-medium truncate flex-1">
                {project.projectName}
              </span>
              <StatusBadges summary={project.statusSummary} />
            </button>

            {!isCollapsed && (
              <div>
                {project.flat
                  ? project.worktrees[0].terminals.map((item) => (
                      <div key={item.terminalId} className="pl-4 pr-2">
                        {renderTerminal(item)}
                      </div>
                    ))
                  : project.worktrees.map((wt) => (
                      <WorktreeRow
                        key={wt.worktreeId}
                        group={wt}
                        renderTerminal={renderTerminal}
                      />
                    ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/ProjectTree.tsx
git commit -m "feat(sessions): add ProjectTree with ProjectRow and WorktreeRow"
```

---

### Task 6: Integrate tree view into SessionsPanel

**Files:**
- Modify: `src/components/SessionsPanel.tsx`

**Step 1: Update imports and add buildProjectTree usage**

Replace the `sections`/`displayGroups` usage in the main render with the new tree. Keep `sections` for Inspector and focused logic.

Add import:
```typescript
import { buildProjectTree } from "./sessionPanelModel";
import { ProjectTree } from "./ProjectTree";
```

Add memo:
```typescript
const projectTree = useMemo(
  () => buildProjectTree(projects, telemetryByTerminalId, sessionsById),
  [projects, telemetryByTerminalId, sessionsById],
);
```

Replace the four `<Section>` calls and the empty state with:
```typescript
<ProjectTree
  projects={projectTree}
  renderTerminal={(item) => (
    <TerminalCard key={item.terminalId} item={item} t={t} compact />
  )}
/>

{!hasAnyTerminals && (
  <div className="flex-1 px-4 py-6 text-[11px] text-[var(--text-faint)] text-center">
    {t.sessions_no_canvas_items}
  </div>
)}
```

Update `hasAnyTerminals` to use `projectTree`:
```typescript
const hasAnyTerminals = !!sections.focused || projectTree.length > 0;
```

Remove unused imports: `buildCanvasTerminalDisplayGroups`, `buildCanvasTerminalSections` (keep `buildCanvasTerminalSections` — still needed for Inspector). Remove `displayGroups` memo and `seenDoneTerminalIds`/`syncActiveDoneIds`/`markCompletionSeen` if no longer used.

**Step 2: Update TerminalCard to hide locationLabel when in tree context**

Add `hideLocation` prop to `TerminalCard`:
```typescript
function TerminalCard({
  item,
  t,
  compact = false,
  hideLocation = false,
}: {
  item: CanvasTerminalItem;
  t: ReturnType<typeof useT>;
  compact?: boolean;
  hideLocation?: boolean;
}) {
  const subtitleParts = [
    !hideLocation && item.locationLabel && item.locationLabel !== item.title
      ? item.locationLabel
      : null,
    formatTerminalActivity(item, t),
    formatShortAge(item.activityAt),
  ].filter(Boolean);
  // ... rest unchanged
```

Pass `hideLocation` from ProjectTree render:
```typescript
<TerminalCard key={item.terminalId} item={item} t={t} compact hideLocation />
```

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/SessionsPanel.tsx src/components/ProjectTree.tsx
git commit -m "feat(sessions): integrate tree view into SessionsPanel"
```

---

### Task 7: Clean up unused code

**Files:**
- Modify: `src/components/SessionsPanel.tsx`
- Modify: `src/components/sessionPanelModel.ts`

**Step 1: Remove the old Section component from SessionsPanel.tsx**

Delete the `Section` component function (lines ~117-143 in current file) since it's no longer used.

**Step 2: Evaluate buildCanvasTerminalDisplayGroups**

If `buildCanvasTerminalDisplayGroups` is only used in `SessionsPanel` for the old flat view, remove it from `sessionPanelModel.ts`. Keep `buildCanvasTerminalSections` — Inspector still needs it.

Also remove `useCompletionSeenStore` imports and related `useEffect`s from `SessionsPanel` if they are no longer needed (the fresh-done concept is now handled by dot brightness in the tree).

**Step 3: Run tests**

Run: `npx tsx --test tests/session-panel-model.test.ts`
Expected: The `buildCanvasTerminalDisplayGroups` test will fail if we removed the export. Update or remove that test accordingly.

**Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/components/SessionsPanel.tsx src/components/sessionPanelModel.ts tests/session-panel-model.test.ts
git commit -m "refactor(sessions): remove old flat section components and display groups"
```

---

### Task 8: Visual QA and polish

**Files:**
- Possibly modify: `src/components/ProjectTree.tsx`, `src/components/SessionsPanel.tsx`

**Step 1: Manual visual check**

Run the app (`npm run dev`) and verify:
- Projects appear as collapsible rows with status badges
- Single-worktree projects show terminals directly (flat mode)
- Multi-worktree projects show worktree sub-rows
- Collapsing a project/worktree hides children but shows aggregated badges
- Clicking a terminal card pans to it on canvas
- Inspector still works for hovered/selected terminal
- Focused terminal still appears at top
- Empty state shows when no terminals exist

**Step 2: Fix any spacing/alignment issues found**

Adjust padding, font sizes, or gap values as needed.

**Step 3: Final typecheck and test**

Run: `npx tsc --noEmit && npx tsx --test tests/session-panel-model.test.ts`
Expected: All pass

**Step 4: Commit any polish**

```bash
git add -A
git commit -m "fix(sessions): polish tree view spacing and alignment"
```
