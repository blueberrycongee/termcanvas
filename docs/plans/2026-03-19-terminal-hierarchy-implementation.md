# Terminal Parent-Child Hierarchy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add visual parent-child hierarchy between terminals spawned by Hydra, with connection lines, badges, and hover tree overlay.

**Architecture:** Add `parentTerminalId` to TerminalData, inject `TERMCANVAS_TERMINAL_ID` env var into every PTY, thread parent ID from Hydra spawn through the API to the store. Render SVG connection lines on the canvas layer, add badges to terminal title bars, and a hover-to-reveal family tree overlay.

**Tech Stack:** React, SVG, Zustand, TypeScript, node-pty

---

### Task 1: Add parentTerminalId to TerminalData

**Files:**
- Modify: `src/types/index.ts:80-94`

Add `parentTerminalId?: string` to the TerminalData interface.

### Task 2: Update createTerminal factory to accept parentTerminalId

**Files:**
- Modify: `src/stores/projectStore.ts:104-124`

Add optional `parentTerminalId` parameter. Thread it into the returned object.

### Task 3: Add hierarchy selectors to projectStore

**Files:**
- Modify: `src/stores/projectStore.ts`

Add standalone helper functions (not store actions):
- `findTerminalById(projects, terminalId)` → returns `{ terminal, projectId, worktreeId } | null`
- `getChildTerminals(projects, terminalId)` → returns array of `{ terminal, projectId, worktreeId }`

### Task 4: Inject TERMCANVAS_TERMINAL_ID env var into PTY

**Files:**
- Modify: `electron/pty-launch.ts:359-419` (buildLaunchSpec)
- Modify: `electron/pty-launch.ts:5-10` (PtyLaunchOptions)
- Modify: `electron/main.ts:147-154` (terminal:create handler)
- Modify: `electron/preload.ts:4-6` (terminal.create)
- Modify: `src/types/index.ts:163-167` (TermCanvasAPI.terminal.create)
- Modify: `src/terminal/TerminalTile.tsx:250-269` (ptyOptions + create call)

Add `terminalId?: string` to PtyLaunchOptions. In buildLaunchSpec, if terminalId is present, set `env.TERMCANVAS_TERMINAL_ID = terminalId`. Pass terminal.id through the whole IPC chain.

### Task 5: Update API server to accept parentTerminalId

**Files:**
- Modify: `electron/api-server.ts:219-254` (terminalCreate)
- Modify: `src/App.tsx:305-309` (__tcApi.addTerminal)

Accept `parentTerminalId` in the POST body. Pass it through to the renderer's addTerminal call and the createTerminal factory.

### Task 6: Update CLI to pass --parent-terminal flag

**Files:**
- Modify: `cli/termcanvas.ts:102-119` (terminal create handler)

Parse `--parent-terminal <id>` flag and include in POST body.

### Task 7: Update Hydra to pass parentTerminalId

**Files:**
- Modify: `hydra/src/termcanvas.ts:33-38` (buildTerminalCreateArgs)
- Modify: `hydra/src/termcanvas.ts:72-74` (terminalCreate)
- Modify: `hydra/src/spawn.ts:138-139` (terminalCreate call)

Read `process.env.TERMCANVAS_TERMINAL_ID` in spawn(). Pass it to terminalCreate. Thread it through CLI args.

### Task 8: Persist parentTerminalId in state save/restore

**Files:**
- Modify: `src/App.tsx:35-46` (migrateProjects)
- Modify: `src/App.tsx:267-293` (__tcApi.getProjects, getTerminal)

Include `parentTerminalId` in migration and in the serialized API response.

### Task 9: Create ConnectionOverlay component

**Files:**
- Create: `src/canvas/ConnectionOverlay.tsx`
- Modify: `src/canvas/Canvas.tsx`

SVG overlay inside `#canvas-layer` (inherits viewport transform). For each parent-child pair:
- Compute absolute positions of parent (center-bottom) and child (center-top) terminals
- Draw bezier curve with parent type color at 30% opacity, 1.5px stroke
- Small arrow at child end
- On terminal hover: highlight connections (80% opacity, glow)

Position computation uses layout constants: `projectPos + PROJ_PAD + worktreePos + WT_PAD + packedX/Y`.

### Task 10: Add parent/child badges to TerminalTile

**Files:**
- Modify: `src/terminal/TerminalTile.tsx:690-715` (title bar area)

For child terminals: show "↑ parentName" badge before title. Click pans to parent.
For parent terminals with children: show child count badge. Click pans to first child.

### Task 11: Add hover-to-reveal family tree overlay

**Files:**
- Create: `src/components/FamilyTreeOverlay.tsx`
- Modify: `src/terminal/TerminalTile.tsx`

After 500ms hover on terminal with connections, show floating card listing parent → children with status dots. Each item clickable to pan. Portal to `#canvas-layer`.

### Task 12: Add i18n strings

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`

Add strings for badges, tooltips, family tree labels.
