# Terminal Parked Runtime Plan

## Summary

This plan narrows the first phase to a conservative goal: restore terminal rendering continuity during a single app session, even if that means higher memory usage for now. The main change is to stop treating offscreen terminals as disposable renderers and instead keep their live xterm instance and real buffer parked until they become visible again.

## Phase 1 Principles

1. Stability first.
   Accept higher memory usage in phase 1 if that avoids renderer teardown and broken recovery.
2. Fix rendering before optimization.
   Restore the real terminal view first; delay WebGL reclamation, LRU eviction, and other aggressive resource work.
3. Avoid large architectural swings.
   Keep PTY, session discovery, telemetry, and agent runtime behavior unchanged unless required for the parked model.

## Current Problem

Today, an offscreen terminal is treated as disposable:

- `resolveTerminalMountMode()` returns `"unmounted"` for non-focused, non-visible terminals in [src/terminal/terminalRuntimePolicy.ts](/Users/doanbactam/termcanvas/src/terminal/terminalRuntimePolicy.ts).
- `setTerminalRuntimeMode()` tears down the renderer for every non-`"live"` mode in [src/terminal/terminalRuntimeStore.ts](/Users/doanbactam/termcanvas/src/terminal/terminalRuntimeStore.ts).
- `detachTerminalRenderer()` serializes a bounded ANSI tail, releases WebGL, and disposes the live xterm instance in [src/terminal/terminalRuntimeStore.ts](/Users/doanbactam/termcanvas/src/terminal/terminalRuntimeStore.ts).
- When the terminal becomes visible again, the app creates a new xterm and replays `previewAnsi`, which is only a best-effort tail buffer rather than the original terminal state.

This is why the PTY can still be alive while the user sees blank areas, broken repaint, or output that no longer matches the terminal they left.

## Important Constraints

### 1. This must cover both renderers

The default renderer is still legacy, not xyflow, via [src/canvas/rendererMode.ts](/Users/doanbactam/termcanvas/src/canvas/rendererMode.ts) and [src/canvas/CanvasRoot.tsx](/Users/doanbactam/termcanvas/src/canvas/CanvasRoot.tsx). Fixing only xyflow would leave the default user path broken.

### 2. A persistent host is required

Current xterm behavior does not allow an already-open terminal instance to be re-opened into a new parent element. That means phase 1 cannot rely on "keep xterm, then later call `open()` on a new tile container". A persistent terminal host layer is required.

### 3. Host lifecycle must be separated from runtime lifecycle

The current runtime store mixes host detach, event cleanup, WebGL release, unregister, and xterm disposal into one path. Phase 1 needs those responsibilities separated so a terminal can leave the visible tile without dying.

### 4. Snapshot behavior must still serialize the real buffer

If parked terminals stop being considered "live" by serialization paths, workspace snapshotting can regress back to `previewAnsi`. That must be prevented.

## Scope

### In

- Preserve the real xterm instance and real buffer when a terminal goes offscreen during the same app run
- Replace the current `live/unmounted` runtime semantics with `live/parked`, while reserving `evicted` for later work
- Introduce a persistent terminal host layer so xterm is no longer tied to tile DOM mount/unmount
- Keep legacy canvas and xyflow canvas behavior aligned
- Keep `previewAnsi` only as fallback for future evicted paths and snapshot safety

### Out

- Perfect terminal history recovery after app restart
- Phase 1 WebGL pooling changes for parked terminals
- Memory pressure thresholds, LRU eviction, or automatic parked-to-evicted transitions
- PTY protocol, session discovery, telemetry schema, or agent renderer redesign

## Phase 1 Plan

### 1. Define the new runtime semantics

- Change the offscreen result in [src/terminal/terminalRuntimePolicy.ts](/Users/doanbactam/termcanvas/src/terminal/terminalRuntimePolicy.ts) from `"unmounted"` to a real parked state.
- Keep `"live"` as the interactive visible state.
- Reserve `"evicted"` as a future explicit state for true teardown and snapshot-only recovery.

### 2. Split detach from destroy

- Refactor [src/terminal/terminalRuntimeStore.ts](/Users/doanbactam/termcanvas/src/terminal/terminalRuntimeStore.ts) so "leave visible rendering" no longer implies:
  - serializing and discarding the live terminal
  - unregistering it from live serialization
  - releasing WebGL
  - disposing xterm
- Keep true disposal only in runtime destruction paths such as terminal close, workspace removal, or explicit teardown.

### 3. Add a persistent terminal host layer

- Add a stable host layer above tiles, ideally shared from the canvas root level.
- Let each runtime own a long-lived host container that survives tile visibility churn.
- Reposition or hide that host when the tile is parked, rather than destroying it.

### 4. Rework tile attach behavior around the host layer

- Update [src/terminal/TerminalTile.tsx](/Users/doanbactam/termcanvas/src/terminal/TerminalTile.tsx) so entering `live` reconnects the tile UI to the existing host and performs one stable `fit + resize`.
- When leaving `live`, only detach or hide the visible association; do not destroy runtime state.
- Move host-bound pointer and selection wiring out of one-time container creation so host migration does not break copy/selection behavior.

### 5. Keep both canvas paths consistent

- Update legacy canvas flow in [src/containers/WorktreeContainer.tsx](/Users/doanbactam/termcanvas/src/containers/WorktreeContainer.tsx).
- Update xyflow runtime mode flow in [src/canvas/XyFlowCanvas.tsx](/Users/doanbactam/termcanvas/src/canvas/XyFlowCanvas.tsx) and [src/canvas/xyflowNodes.tsx](/Users/doanbactam/termcanvas/src/canvas/xyflowNodes.tsx).
- Make sure parked terminals remain recoverable in both paths and do not disappear only because one renderer still treats them as `"unmounted"`.

### 6. Downgrade preview to fallback status

- Keep `previewAnsi` and `previewText`, but stop using them as the normal offscreen recovery path.
- Continue updating preview data for snapshot safety and future eviction support.
- Ensure parked terminals still serialize from the real live runtime buffer in snapshot paths such as [src/snapshotState.ts](/Users/doanbactam/termcanvas/src/snapshotState.ts).

### 7. Add targeted regression coverage

- Update [tests/terminal-runtime-policy.test.ts](/Users/doanbactam/termcanvas/tests/terminal-runtime-policy.test.ts) for the new parked semantics.
- Extend [tests/terminal-runtime-store.test.ts](/Users/doanbactam/termcanvas/tests/terminal-runtime-store.test.ts) to verify:
  - parked mode does not dispose xterm
  - re-entering live reuses the existing runtime
  - buffer continuity survives park and reattach
- Add one regression test that guards consistent behavior across legacy and xyflow mount decisions.

## Validation

Run the smallest checks that exercise the changed contract:

1. `npm run typecheck`
2. Targeted terminal runtime tests
3. Any focused renderer lifecycle regression test added for parked reattach behavior

Manual verification should confirm:

- Scroll terminal offscreen, then back onscreen, and the same history is still present
- No blank terminal frame appears after reattach
- Focus and resize still work after a parked terminal becomes live again
- Snapshot serialization still captures real terminal content

## Risks And Deferred Work

### Accepted in phase 1

- Higher memory usage from keeping more xterm instances alive
- Higher renderer cost than the current offscreen-destroy model

### Explicitly deferred

- Releasing WebGL while keeping xterm alive
- Parked-terminal memory caps
- LRU eviction under pressure
- Automatic promotion from parked to evicted

## Exit Criteria

Phase 1 is complete when all of the following are true:

- Offscreen terminals no longer rely on xterm disposal plus `previewAnsi` replay as the default recovery path
- Returning a terminal to view restores the original live terminal state rather than a reconstructed approximation
- Legacy and xyflow renderers behave consistently
- Typecheck and targeted terminal tests pass
