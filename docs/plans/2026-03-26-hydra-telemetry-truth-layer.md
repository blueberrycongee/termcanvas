# Hydra Telemetry Truth Layer Implementation Plan

> **Execution note:** Use `executing-plans` to implement this plan task-by-task, or another equivalent execution workflow supported by the current agent runtime.

**Goal:** Build the telemetry truth layer described in `docs/hydra-telemetry-truth-layer-design.md` so TermCanvas, Hydra, and agents query the same runtime facts.

**Architecture:** Add an Electron-side telemetry service that records provider-neutral events and snapshots from PTY, session, process, git/worktree, and Hydra contract files. Expose query APIs through Electron preload, the local HTTP/CLI surface, Hydra status/watch integration, and a lightweight UI panel without changing the authoritative completion gate (`result.json` + `done`).

**Tech Stack:** TypeScript, Electron IPC, local HTTP API, React/Zustand UI, Node test runner

---

### Task 1: Core Telemetry Service

**Files:**
- Create: `electron/telemetry-types.ts`
- Create: `electron/telemetry-service.ts`
- Create: `tests/telemetry-service.test.ts`
- Modify: `electron/session-watcher.ts`
- Modify: `electron/process-detector.ts`

**Step 1: Write failing parser/service tests**

- Add tests for session event normalization, process snapshots, bounded event rings, meaningful-progress updates, and derived status transitions.

**Step 2: Run targeted tests to verify failure**

Run: `npm test -- --test tests/session-watcher.test.ts tests/process-detector.test.ts tests/telemetry-service.test.ts`

**Step 3: Implement minimal telemetry core**

- Define telemetry event/snapshot/workflow view types.
- Add session adapters for Claude and Codex.
- Add process snapshot helpers with descendant/foreground tool support.
- Add the in-memory telemetry service with event append, snapshot derivation, bounded events, worktree watching, process polling, and contract probing hooks.

**Step 4: Run targeted tests to verify pass**

Run: `npm test -- --test tests/session-watcher.test.ts tests/process-detector.test.ts tests/telemetry-service.test.ts`

**Step 5: Commit**

```bash
git add electron/telemetry-types.ts electron/telemetry-service.ts electron/session-watcher.ts electron/process-detector.ts tests/session-watcher.test.ts tests/process-detector.test.ts tests/telemetry-service.test.ts
git commit -m "feat: add telemetry truth layer core"
```

### Task 2: Query APIs and CLI Surfaces

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/api-server.ts`
- Modify: `cli/termcanvas.ts`
- Modify: `src/types/index.ts`
- Modify: `hydra/src/termcanvas.ts`
- Modify: `hydra/tests/termcanvas.test.ts`

**Step 1: Write failing API/CLI tests**

- Add tests for new termcanvas telemetry argv builders and any pure API helpers introduced for workflow lookup.

**Step 2: Run targeted tests to verify failure**

Run: `npm test -- --test tests/telemetry-service.test.ts hydra/tests/termcanvas.test.ts`

**Step 3: Implement query surfaces**

- Wire the telemetry service into Electron PTY/session IPC.
- Expose preload APIs and HTTP routes for terminal/workflow snapshots and event lists.
- Add `termcanvas telemetry get/events` commands.
- Add Hydra helpers for querying telemetry by workflow.

**Step 4: Run targeted tests to verify pass**

Run: `npm test -- --test tests/telemetry-service.test.ts hydra/tests/termcanvas.test.ts`

**Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts electron/api-server.ts cli/termcanvas.ts src/types/index.ts hydra/src/termcanvas.ts hydra/tests/termcanvas.test.ts
git commit -m "feat: expose telemetry query APIs"
```

### Task 3: Hydra Advisory Consumption

**Files:**
- Modify: `hydra/src/status.ts`
- Modify: `hydra/src/watch.ts`
- Modify: `hydra/src/workflow-store.ts`
- Create: `hydra/src/telemetry.ts`
- Create: `hydra/tests/telemetry.test.ts`

**Step 1: Write failing Hydra telemetry tests**

- Add tests for workflow telemetry aggregation and status/watch payload enrichment.

**Step 2: Run targeted tests to verify failure**

Run: `cd hydra && npm test -- tests/telemetry.test.ts tests/termcanvas.test.ts`

**Step 3: Implement Hydra advisory view**

- Aggregate current handoff, current terminal telemetry, contract state, and retry/timeout budgets.
- Include advisory telemetry in `hydra status` and `hydra watch` output without changing workflow completion rules.

**Step 4: Run targeted tests to verify pass**

Run: `cd hydra && npm test -- tests/telemetry.test.ts tests/termcanvas.test.ts`

**Step 5: Commit**

```bash
git add hydra/src/telemetry.ts hydra/src/status.ts hydra/src/watch.ts hydra/src/workflow-store.ts hydra/tests/telemetry.test.ts
git commit -m "feat: add hydra telemetry advisory views"
```

### Task 4: UI, Docs, and Skill Adoption

**Files:**
- Modify: `src/terminal/terminalRuntimeStore.ts`
- Modify: `src/terminal/TerminalTile.tsx`
- Create: `tests/terminal-telemetry-panel.test.tsx`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `skills/skills/hydra/SKILL.md`

**Step 1: Write failing UI/docs-adjacent tests**

- Add a focused UI test for rendering telemetry facts/badge from the new preload API.

**Step 2: Run targeted tests to verify failure**

Run: `npm test -- --test tests/terminal-runtime-store.test.ts tests/terminal-telemetry-panel.test.tsx`

**Step 3: Implement UI + usage guidance**

- Attach/detach sessions to the telemetry service from runtime store.
- Poll terminal telemetry snapshots for badge/fact display.
- Document the new CLI commands and update Hydra skill guidance to consult telemetry before retry/takeover decisions.

**Step 4: Run targeted tests to verify pass**

Run: `npm test -- --test tests/terminal-runtime-store.test.ts tests/terminal-telemetry-panel.test.tsx`

**Step 5: Commit**

```bash
git add src/terminal/terminalRuntimeStore.ts src/terminal/TerminalTile.tsx tests/terminal-runtime-store.test.ts tests/terminal-telemetry-panel.test.tsx README.md README.zh-CN.md skills/skills/hydra/SKILL.md
git commit -m "feat: surface telemetry in UI and docs"
```

### Task 5: End-to-End Verification

**Files:**
- Verify only

**Step 1: Run focused packages**

Run: `npm test -- --test tests/session-watcher.test.ts tests/process-detector.test.ts tests/telemetry-service.test.ts tests/terminal-runtime-store.test.ts tests/terminal-telemetry-panel.test.tsx`

**Step 2: Run Hydra test suite slices**

Run: `cd hydra && npm test -- tests/termcanvas.test.ts tests/telemetry.test.ts`

**Step 3: Run typechecks**

Run: `npm run typecheck && cd hydra && npm run typecheck`

**Step 4: Manual smoke check**

- Use `termcanvas telemetry get --terminal <id>` against a live terminal.
- Use `hydra status --repo . --workflow <id>` and confirm telemetry advisory fields appear.

**Step 5: Final commit if fixes were needed**

```bash
git add <only follow-up fix files>
git commit -m "fix: polish telemetry truth layer verification issues"
```
