# Ghostty Mouse Selection Offset: Canvas-Anchored Fix

**Baseline**: `a753e80` (2026-03-25)  
**Files**:
- `src/terminal/TerminalTile.tsx`
- `src/terminal/mousePosition.ts`
- `src/canvas/Canvas.tsx`
- `thirdparty/ghostty-web/lib/selection-manager.ts`
- `thirdparty/ghostty-web/lib/input-handler.ts`

## Bug Summary

After migrating the terminal renderer from xterm.js to `ghostty-web`, mouse
selection could become visibly offset when the canvas workspace was zoomed.

The app renders terminal tiles inside a canvas-like layer that is transformed
with:

```ts
transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
```

That means terminal DOM events are fired inside an ancestor with CSS
`scale(...)`.

The visible symptom was:

- the mouse cursor appeared at one location
- but Ghostty started or extended the selection at a different location
- the error was large enough to span multiple cells, not just a small pixel
  drift

## Why The Old Patch Existed

The xterm.js implementation already had a mouse-correction patch for scaled
canvas mode. It intercepted mouse events in the capture phase, rewrote the
coordinates from visual space back into terminal-local space, and re-dispatched
the synthetic event.

That strategy was carried forward during the Ghostty migration.

## What Went Wrong

The migration kept the same high-level idea, but the correction was anchored to
the wrong DOM reference.

Before `a753e80`, the code in `TerminalTile.tsx` did this:

1. Intercept `mousedown` / `mousemove` / `mouseup` / `dblclick`
2. Read `viewport.scale`
3. Use `e.target.getBoundingClientRect()` as the coordinate frame
4. Recompute `clientX/clientY`
5. Override `offsetX/offsetY/layerX/layerY`
6. Re-dispatch the event back to `e.target`

This was too loose for Ghostty.

`ghostty-web` does not treat every terminal child node as an equivalent mouse
coordinate target. Its selection and mouse paths are centered around the
terminal canvas:

- `SelectionManager` reads `e.offsetX / e.offsetY`
- `InputHandler` uses `clientX/clientY - canvas.getBoundingClientRect()`

So once the correction was based on an arbitrary event target instead of the
actual terminal canvas, the integration could feed Ghostty coordinates from the
wrong local space.

In practice, this meant:

- the synthetic event was corrected relative to one element
- but Ghostty interpreted it relative to the canvas
- under CSS scale, that mismatch amplified into a visible selection offset

## Why The Fix Worked

Commit `a753e80` tightened the correction path so it is always canvas-anchored.

The new behavior is:

1. Look up the actual terminal `canvas` inside the terminal container
2. Only intervene when the original event target is that `canvas`
3. Use `canvas.getBoundingClientRect()` as the only correction frame
4. Re-dispatch the corrected event back to the `canvas`

This removed the ambiguity in the coordinate space.

Instead of saying “correct relative to whichever element received the event,”
the code now says “Ghostty hit-testing is canvas-based, so the correction must
also be canvas-based.”

That matches Ghostty's own implementation much better:

- selection math stays aligned with canvas-local `offsetX/offsetY`
- mouse tracking stays aligned with canvas-local
  `clientX/clientY - rect.left/top`

## Key Takeaway

The problem was not that scaled mouse correction is inherently wrong.

The problem was that the correction layer preserved an xterm-era assumption:
“the terminal target element is interchangeable.”

That assumption is unsafe for `ghostty-web`.

For Ghostty, if mouse correction is needed at all, it should be anchored to the
real terminal canvas, not to an arbitrary event target inside the terminal
subtree.

## Follow-Up Rule

When debugging any future Ghostty input issue under transformed layouts:

- treat the canvas as the source of truth for pointer coordinates
- do not assume xterm's DOM/event behavior carries over just because the public
  API is compatible
- if a workaround rewrites mouse events, verify that the rewritten event is
  expressed in the same coordinate frame Ghostty itself uses internally
