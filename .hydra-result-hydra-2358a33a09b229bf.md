## Files changed and why

- `.hydra-result-hydra-2358a33a09b229bf.md`: recorded the review findings for the `src/terminal/TerminalTile.tsx` scroll-pinning diff.

## Issues found

1. High: `followBottom` only tracks wheel direction, so user scroll-up via keyboard, scrollbar drag, or any non-wheel path is invisible to the state at [src/terminal/TerminalTile.tsx](/Users/zzzz/termcanvas/src/terminal/TerminalTile.tsx#L178) and [src/terminal/TerminalTile.tsx](/Users/zzzz/termcanvas/src/terminal/TerminalTile.tsx#L373). In those cases the next output chunk still executes `scrollToBottom()` and snaps the viewport back down, which violates the stated requirement to respect user scroll-up. The fix should derive follow-mode from actual viewport position changes, for example via `xterm.onScroll` or by checking `buffer.active.viewportY < buffer.active.baseY`, rather than from wheel events alone.

2. Medium: the wheel heuristic disables follow mode on any negative `deltaY`, even when the viewport did not actually move at all at [src/terminal/TerminalTile.tsx](/Users/zzzz/termcanvas/src/terminal/TerminalTile.tsx#L179). That can happen with no available scrollback yet, touchpad overscroll/inertia noise, or other wheel events that do not leave the bottom. In that state streaming output stops auto-following until the user later scrolls down far enough to hit bottom again. This is another reason to key follow-mode off the terminal's real scroll position instead of raw wheel direction.

3. Medium: `scrollToBottom()` is called after every write while follow mode is enabled at [src/terminal/TerminalTile.tsx](/Users/zzzz/termcanvas/src/terminal/TerminalTile.tsx#L373). In local `@xterm/xterm` 6.0.0, `scrollToBottom()` delegates to `scrollLines(...)`, and `scrollLines` always calls a full `refresh(0, rows - 1)` even when already at bottom. During token-by-token AI CLI streaming that adds an extra repaint per chunk and is likely more work than necessary. A safer version would first check whether `viewportY !== baseY` before calling `scrollToBottom()`, so the corrective scroll only runs when the viewport has actually drifted.

## Other review notes

- `buffer.active.viewportY` and `buffer.active.baseY` are valid public `IBuffer` properties in the installed `@xterm/xterm` 6.0.0 typings, so the API usage itself is correct.
- The direct DOM `wheel` listener on `xterm.element` should not create a persistent leak by itself: `xterm.dispose()` removes the element from the DOM, and the listener is owned by that element. Explicit cleanup is still cleaner, but I do not see this as a blocking leak in the current lifecycle.
- `deltaY === 0` is effectively ignored by the current code, which is fine; the real problem is that nonzero deltas are treated as intent even when the viewport does not move.

## Whether tests pass

- Not run. This was a review-only task and no product code was changed.

## Unresolved problems

- The current implementation still needs a more reliable follow-mode source of truth based on actual terminal scroll state.
