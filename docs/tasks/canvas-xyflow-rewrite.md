# Canvas XyFlow Rewrite

## Goal

Replace the current hand-rolled canvas substrate with a single-library XyFlow implementation while keeping DOM-first terminals and creating a future-proof internal annotation path for drawing.

This task is organized by module, but the execution model is optimized for exactly two implementation agents. The module split is the unit of ownership; the lane assignment is the default parallel plan.

## Locked Decisions

- Use one canvas library only: `@xyflow/react`.
- Keep DOM nodes as the primary rendering primitive.
- Keep terminals as live DOM/xterm, not canvas-rendered objects.
- Treat drawing as an internal annotation subsystem inside the XyFlow viewport.
- Do not keep the current hand-written viewport/selection/drag substrate on the main path.
- Right-side `diff/file` panels are not part of the new canvas target.
- Preserve workspace compatibility by reading legacy snapshots and migrating forward.

## Why The JSON Is Structured This Way

The paired JSON is designed for two external agents that will not inherit chat context. Each task object keeps the fields an agent needs in one place:

- `lane`: default owner lane, `A` or `B`
- `depends_on`: hard prerequisites
- `writes`: expected write surface to reduce merge overlap
- `passes`: the local completion gate
- `status`: execution state only

Top-level `current` is also lane-aware so two agents can tell immediately whether they should start, wait, or pick up the next dependency-free task.

## Two-Agent Execution Model

### Lane A

- Owns the structural canvas path:
  - scene contracts
  - XyFlow shell
  - project/worktree node projection
  - annotation subsystem
  - final performance closure if no conflicts remain

### Lane B

- Owns runtime and migration-heavy work:
  - persistence bridge
  - terminal runtime containment
  - interaction/selection/focus merge
  - cutover and final fallback path

### Expected Order

1. Lane A completes `mod-01-scene-contracts`.
2. Lane A starts `mod-03-xyflow-shell`; Lane B starts `mod-02-persistence-bridge`.
3. Lane A starts `mod-04-project-worktree-nodes`; Lane B starts `mod-05-terminal-runtime`.
4. Lane B starts `mod-06-interactions`; Lane A starts `mod-07-annotations`.
5. One lane finishes `mod-08-cutover`.
6. One lane finishes `mod-09-performance-closure`.

## Module Slices

### MOD-00 Task Tracking

- Purpose: persistent orchestration only.
- Write surface:
  - `docs/tasks/canvas-xyflow-rewrite.md`
  - `docs/tasks/canvas-xyflow-rewrite.json`
- Pass gate:
  - paired files exist
  - all later modules have dependencies and pass gates

### MOD-01 Scene Contracts

- Purpose: define the new shared state boundary so later agents do not invent incompatible types.
- Write surface:
  - `src/types`
  - new scene-specific files under `src/stores` or `src/canvas`
  - migration contract entry points only
- Must produce:
  - `SceneDocument`
  - `SceneRuntime`
  - `SceneCamera`
  - `SceneSelection`
  - `AnnotationElement`
- Must not touch:
  - renderer switching
  - terminal runtime internals
  - drawing UI

### MOD-02 Persistence Bridge

- Purpose: bridge legacy snapshot data into the new scene shape without switching renderer paths yet.
- Write surface:
  - `src/snapshotState.ts`
  - restore/load helpers in app bootstrap
- Must produce:
  - v1 read path
  - in-memory migration into new contracts
  - no forced v2-only runtime yet
- Must not touch:
  - XyFlow mounting
  - terminal DOM lifecycle

### MOD-03 XyFlow Shell

- Purpose: replace the viewport shell and camera substrate.
- Write surface:
  - `src/canvas`
  - app-level canvas mounting
  - viewport adapter helpers
- Must produce:
  - XyFlow root
  - pan/zoom/fit adapter
  - temporary hidden fallback to legacy shell
- Must not touch:
  - terminal runtime internals
  - persistence migration details

### MOD-04 Project/Worktree Nodes

- Purpose: move project/worktree rendering into the node plane.
- Write surface:
  - `src/containers`
  - node projection helpers
  - world bounds registry
- Must produce:
  - project/worktree node mapping
  - drag behavior in XyFlow
  - removal of legacy absolute-position main path
- Must not touch:
  - terminal spawn/session logic
  - drawing subsystem

### MOD-05 Terminal Runtime

- Purpose: isolate terminal cost and keep xterm complexity local.
- Write surface:
  - `src/terminal`
  - worktree-local terminal layout helpers
  - terminal geometry registry
- Must produce:
  - terminal geometry publication
  - live/preview/unmounted LOD policy
  - worktree-local drag/reorder/span update path
- Must not touch:
  - XyFlow shell internals
  - snapshot format decisions

### MOD-06 Interactions

- Purpose: unify selection, focus, delete, keyboard, and pan helpers around the new node plane.
- Write surface:
  - selection store/runtime
  - keyboard shortcut wiring
  - focus/pan helpers
- Must produce:
  - node selection mapping
  - merged terminal-local selection
  - batch delete path
  - focus cycle and pan-to-terminal/worktree behavior
- Must not touch:
  - terminal spawn/session internals
  - drawing rendering internals

### MOD-07 Annotations

- Purpose: replace the legacy drawing layer with an internal annotation subsystem.
- Write surface:
  - drawing/annotation types and store
  - drawing overlay renderer
  - drawing tool UI
- Must produce:
  - migration from legacy `drawings`
  - annotation rendering inside the XyFlow viewport
  - `pen`, `text`, `rect`, `arrow`
  - future anchor model for `world` and `entity`
- Must not touch:
  - second canvas library
  - terminal runtime

### MOD-08 Cutover

- Purpose: make the new path the default safely.
- Write surface:
  - app bootstrap
  - fallback switch
  - final snapshot write path
- Must produce:
  - new path default on
  - hidden fallback path
  - v2 write path after migration is stable
- Must not touch:
  - new product scope

### MOD-09 Performance Closure

- Purpose: verify the rewrite solved the hot paths that justified it.
- Write surface:
  - performance instrumentation
  - selector tightening
  - memoization and mounting policy
- Must produce:
  - drag-path render audit
  - visible-only mounting policy
  - clear note if any module must be rolled back

## Validation Policy

- A module is complete only when its `passes` gate in JSON is satisfied.
- If validation fails and is not fixed immediately:
  - mark the module `blocked` or `rolled_back` in JSON
  - record the first actionable failure below
  - stop advancing dependent modules
- Agents should prefer their assigned lane unless a dependency chain is exhausted.

## Known Risks

- Terminal DOM cost may remain the dominant bottleneck even after the canvas substrate is replaced.
- Annotation migration can temporarily lag behind node-plane migration.
- Legacy overlap resolution may accidentally remain in the drag hot path if MOD-04 does not cut it out aggressively.
- Selection/focus can fork if MOD-06 keeps old and new sources alive simultaneously.

## First Actionable Failure

- `mod-08-cutover` is still blocked on `mod-07-annotations`, so Lane B cannot validate default-path switch or v2 snapshot writes on this branch yet.

## Latest Validation

- Lane A completed `mod-01-scene-contracts`, `mod-03-xyflow-shell`, and `mod-04-project-worktree-nodes`.
- Lane B completed `mod-02-persistence-bridge`, `mod-05-terminal-runtime`, and `mod-06-interactions`.
- Post-review fixes made `scene` the authoritative v2 snapshot format, aligned `snapshotBridge`/restore/write paths with the declared scene contract, and updated preload typing/tests to match the persisted payload shape.
- Post-review fixes keep terminal runtimes mounted outside `onlyRenderVisibleElements`, republish terminal geometry from live XYFlow node positions during drag, avoid camera/store desync during animated pans, and route keyboard terminal centering through the shared `panToTerminal()` path.
- Post-review fixes auto-expand collapsed projects/worktrees on worktree focus, drop hidden worktrees from focus order, keep visible non-focused terminals live, and clear stale PTY ids when runtimes are destroyed.
- Second-pass fixes harden `snapshotBridge` so unrelated JSON is rejected instead of silently becoming an empty workspace, invalid scene annotations are skipped safely, and entity-anchored annotations round-trip through the legacy drawing bridge.
- Second-pass fixes preserve persisted terminal status while still sanitizing runtime-only `ptyId`, guard `setFocusedTerminal()`/`setFocusedWorktree()` against invalid targets, and blur live xterm instances when focus is cleared or a terminal leaves `live` mode.
- Second-pass fixes stop non-layout `projectStore` churn from resetting local XYFlow drag state, centralize runtime syncing inside `TerminalRuntimeLayer`, remove the duplicate viewport-based LOD calculation from `WorktreeNode`, and make viewport intersection / fit-to-all calculations respect the right-side panel width.
- `npm run typecheck` passes.
- `npx tsx --test tests/canvas-xyflow-rewrite.test.ts tests/project-focus.test.ts tests/project-store-focus.test.ts tests/terminal-focus-regression.test.ts tests/terminal-runtime-policy.test.ts tests/terminal-runtime-store.test.ts tests/snapshot-state.test.ts tests/shortcut-behavior.test.ts tests/project-store-sync-worktrees.test.ts tests/worktree-focus-order.test.ts` passes.
- `tests/canvas-xyflow-rewrite.test.ts` is wired into `npm test`.

## Handoff

- Agents should read this note and the paired JSON before taking any slice.
- Agents should not take tasks with overlapping `writes` surfaces at the same time.
- Agents should report completion strictly against the `passes` gates in JSON.
- Lane A is now clear to start `mod-07-annotations`.
