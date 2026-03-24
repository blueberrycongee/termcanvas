# Ghostty-Web Spike

Date: 2026-03-24
Branch: `experiment/ghostty-web-spike`

## Problem Statement

TermCanvas currently embeds terminals with xterm.js. We have spent a long time
fighting scroll behavior during streaming AI CLI output, especially for Codex
and Claude sessions with sustained output.

The most painful user-visible failure mode right now is:

1. User scrolls upward to read previous output.
2. User reaches the top of the visible scrollback.
3. The viewport is forcibly snapped back to the live bottom.

This is not acceptable behavior for a terminal reader. It breaks trust in the
viewport and makes long-running agent sessions hard to inspect.

There is also a second class of historical pain around scroll-pinning under
heavy output: once scrollback fills and trimming begins, xterm.js internal
scroll state can drift in ways that are difficult to reason about and have led
to multiple local patches. Those patches have themselves become a source of
regression risk.

## Current Understanding

The immediate snap-to-bottom bug appears to be caused by our own xterm.js
patching layer, not by a mandatory xterm.js default behavior. Specifically,
`src/terminal/TerminalTile.tsx` contains custom scroll recovery logic that tries
to detect a "stuck at top during trimming" state and calls
`scrollToBottom()`. In normal user scroll-to-top cases, that heuristic is too
broad and misfires.

Even if that specific bug is fixed, the larger concern remains:

- We are relying on xterm.js internals and private state.
- We already maintain custom behavior around scroll, selection, serialization,
  WebGL, and terminal restore.
- Scroll semantics under streaming output have been fragile enough to consume
  significant debugging time.

Because of that, we want to evaluate whether a different terminal frontend
foundation would reduce long-term complexity.

## Spike Goal

Evaluate whether `ghostty-web` is a credible replacement for xterm.js in
TermCanvas.

This spike is not approved as a full migration. It is a bounded experiment to
answer whether switching foundations is realistic and whether it improves the
specific user experience problems that have been expensive to maintain on
xterm.js.

## Primary Goals

1. Stand up a minimal `ghostty-web` terminal tile inside TermCanvas.
2. Confirm that we can render PTY output in the existing React/Electron
   architecture.
3. Test whether scrolling behavior during sustained AI CLI streaming is more
   predictable than our current xterm.js setup.
4. Measure the migration surface area for the features we already depend on.
5. Decide whether full migration is worth pursuing, or whether fixing xterm.js
   locally is still the better path.

## Non-Goals

This spike should not attempt to fully ship a new terminal stack.

Specifically out of scope:

- complete production migration
- parity for every existing terminal feature
- unrelated UI cleanup
- changing PTY backend architecture
- solving every historical xterm.js issue during the spike

## What We Need To Learn

### 1. Integration Feasibility

- Can `ghostty-web` run cleanly in our Electron renderer?
- What initialization/runtime requirements does it impose?
- Does it fit our current terminal lifecycle model?

### 2. Feature Parity Gaps

We currently depend on:

- terminal fitting on resize
- scrollback restore / serialization
- theme switching
- selection + copy behavior
- direct key handling
- inline image support
- GPU-accelerated rendering path
- focus management
- terminal buffer inspection for viewport state

The spike needs to identify which of these are:

- supported directly
- available via different APIs
- available only through custom adaptation
- missing or impractical

### 3. Scroll Behavior

The spike must explicitly test:

- user scroll-up during streaming output
- reaching top of scrollback
- staying away from bottom while output continues
- behavior once scrollback becomes large
- whether any forced snap-to-bottom or unexpected drift still appears

### 4. Migration Cost

We need an honest estimate of:

- how much of `TerminalTile.tsx` would need replacement
- whether our xterm-specific addons have equivalents
- whether custom compatibility glue would offset any benefits

## Success Criteria For The Spike

The spike is successful if, by the end, we have:

1. A working experimental terminal path using `ghostty-web`.
2. A written comparison of xterm.js vs `ghostty-web` for TermCanvas needs.
3. A clear answer on whether migration should proceed.

## Decision Criteria

We should consider migration only if most of the following are true:

- scroll behavior is materially better
- the integration is stable enough for our Electron app
- missing features are limited and manageable
- custom compatibility glue is smaller than the complexity we are trying to
  escape

We should stop and stay on xterm.js if:

- `ghostty-web` still requires heavy patching for our use cases
- feature gaps are large
- performance or correctness regresses
- the migration cost is high relative to simply fixing the current bug

## Immediate Next Step

Build a minimal experimental terminal component on this branch that can:

- initialize `ghostty-web`
- attach to a DOM container
- stream PTY output
- accept keyboard input
- expose enough behavior to manually test scroll semantics
