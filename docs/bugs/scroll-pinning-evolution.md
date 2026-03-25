# Scroll-Pinning Bug: Evolution of Fixes

## Problem

During AI CLI (Claude, Codex) streaming output, the terminal viewport
fails to stay pinned to the bottom, or snaps back when the user tries
to scroll up to read history.

## Fix Attempts (chronological)

### Attempt 1: `9fd6689` — xterm.onScroll as single source of truth

- Used `xterm.onScroll()` (buffer-level event) + `programmaticScroll` boolean
  to track follow-bottom state.
- **Failed because**: `xterm.onScroll()` only fires for buffer-level pushes,
  NOT for user viewport scrolling. User scroll-up was invisible.

### Attempt 2: `9a75fd7` — viewport DOM scroll event

- Switched to `.xterm-viewport` native `scroll` event. Upgraded guard to
  `programmaticScrollCount` counter with `setTimeout(0)` for async dispatch.
- **Failed because**: still can't distinguish user scrolls from xterm's own
  internal auto-scroll. During streaming, counter is often >0 and user scrolls
  get swallowed by the guard.

### Attempt 3: `a32faa2` — relaxed guard for non-bottom scrolls

- Fixed the guard: only skip scroll events that are BOTH programmatic AND at
  bottom. User scrolls away from bottom are always honored.
- **Failed because**: same fundamental model — still deriving `followBottom`
  from scroll events. xterm internal scrolls, buffer/baseY timing, DOM scroll
  dispatch order can still cause misdetection.

### Attempt 4: `18fd0dc` — user input event tracking (current)

- **Fundamentally different approach**: track user INTENT via synchronous
  input events, not scroll POSITION via async scroll events.
- `wheel (deltaY < 0)` and `PageUp/Home keydown` → `userScrolledUp = true`
- `scroll` event only used for re-enabling: when `userScrolledUp` is true
  and viewport reaches bottom → reset to false.
- Write callback: `scrollToBottom()` unconditionally unless `userScrolledUp`.

## Why Attempt 4 is Different

| Aspect | Attempts 1–3 | Attempt 4 |
|--------|-------------|-----------|
| Signal source for "stop following" | scroll event (ambiguous) | wheel/keydown (unambiguous) |
| Race condition | scroll event timing vs write callback | None — input events are synchronous |
| Guard complexity | programmaticScroll counter + setTimeout | None needed |
| scroll event role | Both enable AND disable follow | Only re-enable (from scrolled-up → follow) |

The core insight: **scroll events don't carry "why" information**. No amount
of guarding can reliably distinguish user scrolls from programmatic/content
scrolls through the scroll event alone. Input events (wheel, keydown) are
synchronous, user-initiated, and never fired by programmatic scrolls.

## Known Remaining Edge Cases

1. **Scrollbar drag up**: only fires `scroll` events (no wheel/keydown),
   so `userScrolledUp` won't be set. User gets pulled back to bottom.
   Fix: detect via `pointerdown` position on viewport's scrollbar area.

2. **Home/PageUp false positive**: in full-screen TUI apps, these keys may
   be consumed by the app without actually scrolling the viewport.
   Mitigation: acceptable — worst case is auto-follow stops until viewport
   reaches bottom.

3. **wheel in mouse-reporting mode**: some TUI apps consume wheel events.
   Same mitigation as above.

These edge cases don't affect the primary use case (mouse wheel scroll-up
during Claude/Codex streaming).

### Attempt 5: `909dd28` — rely entirely on xterm v6 isUserScrolling

- Removed all manual scroll management. Added an `onScroll` handler to
  detect when `isUserScrolling` gets stuck at `viewportY=0` (ydisp
  decremented to 0 by buffer trimming) and snap to bottom.
- **Failed because**: the fix only triggered at the extreme (ydisp=0).
  The viewport DRIFT itself was the real problem — as ydisp decremented
  from the user's position toward 0, the user saw their content scroll
  away. The snap-to-bottom at 0 was just the final symptom.

### Attempt 6 (current fix): monkey-patch BufferService.scroll()

- **Root cause**: `BufferService.scroll()` decrements `buffer.ydisp` by 1
  on every buffer trim when `isUserScrolling` is true. This is intended
  to keep the viewport pointed at the same content (as lines shift in the
  circular buffer), but it causes the viewport to drift toward ydisp=0
  during extended streaming.
- **Fix**: Monkey-patch `_bufferService.scroll()` to freeze `buffer.ydisp`
  (via a temporary `Object.defineProperty` accessor) during the scroll()
  call when `isUserScrolling && buffer.lines.isFull`. The trim decrement
  is silently ignored. The viewport stays at its absolute position while
  content shifts beneath it (natural for a circular buffer).
- **Why this works**: The freeze only applies during the synchronous
  execution of `scroll()`. `scrollLines()` (user-initiated scrolling) is
  a separate method and is not affected. `onScroll` events fire with the
  frozen (stable) ydisp, so the Viewport never updates to a drifting
  position. When the user scrolls to the bottom, `scrollLines()` resets
  `isUserScrolling` to false, and normal auto-follow resumes.
- **Trade-off**: The content at the viewport's position shifts as old lines
  are evicted — the user sees newer content "flow through" their viewport.
  This is acceptable since the old content is gone regardless.
