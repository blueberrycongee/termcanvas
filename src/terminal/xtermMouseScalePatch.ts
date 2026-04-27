import type { Terminal } from "@xterm/xterm";

/**
 * Compensate xterm hit-testing for the canvas-level CSS scale transform.
 *
 * Why
 * ---
 * React Flow wraps tiles in `transform: scale(s)`. xterm's hit-test does:
 *
 *     col = ceil((event.clientX - screenRect.left) / cell.width)
 *
 * - `clientX - screenRect.left` is **visual** pixels (rect is post-transform).
 * - `cell.width` is **CSS layout** pixels (xterm doesn't know about the
 *   transform; the value is computed from char measurement, no rect involved).
 *
 * The mismatch makes xterm read each visual pixel as `1/s` of a cell, so the
 * column it lands on is `s × intended_col`. At s>1 a one-pixel drag selects
 * a swathe of cells.
 *
 * What
 * ----
 * Patch xterm's `_mouseService` so every event fed to `getCoords` has its
 * coordinates pre-scaled back into CSS layout space:
 *
 *     adjustedClientX = rect.left + (clientX - rect.left) / scale
 *
 * Doing it at the mouse-service layer means we don't have to intercept and
 * re-dispatch DOM events at all — xterm's normal listeners (mousedown on
 * `.xterm`, mousemove/mouseup on `document`) fire as usual, and the
 * correction only applies at the moment xterm asks "what column is this?".
 *
 * Caveats
 * -------
 * 1. We reach into `terminal._core._mouseService`, which is private. If a
 *    future xterm release renames or restructures these internals the patch
 *    becomes a no-op (defensive null-check returns the empty disposer). Bump
 *    of `@xterm/xterm` → re-verify this path.
 * 2. `SelectionService._getMouseEventScrollAmount` (drag-past-edge auto-scroll)
 *    bypasses `_mouseService` and calls the lower-level `getCoordsRelativeToElement`
 *    directly. Under zoom that threshold is computed in visual px against a
 *    CSS-px canvas height — auto-scroll still works, just kicks in at a
 *    slightly different drag distance. Not worth fixing unless someone reports it.
 * 3. We add one extra `getBoundingClientRect()` per mouse event when scale ≠ 1.
 *    Negligible; the scale === 1 shortcut keeps the common path zero-cost.
 */

type MouseEventCoords = { clientX: number; clientY: number };

type MouseServiceLike = {
  getCoords: (
    event: MouseEventCoords,
    element: HTMLElement,
    cols: number,
    rows: number,
    isSelection?: boolean,
  ) => [number, number] | undefined;
  getMouseReportCoords: (
    event: MouseEventCoords,
    element: HTMLElement,
  ) => unknown;
};

type XtermInternals = { _core: { _mouseService?: MouseServiceLike } };

function adjust(
  event: MouseEventCoords,
  element: HTMLElement,
  scale: number,
): MouseEventCoords {
  const rect = element.getBoundingClientRect();
  return {
    clientX: rect.left + (event.clientX - rect.left) / scale,
    clientY: rect.top + (event.clientY - rect.top) / scale,
  };
}

export function patchXtermMouseService(
  xterm: Terminal,
  getScale: () => number,
): () => void {
  const core = (xterm as unknown as XtermInternals)._core;
  const ms = core?._mouseService;
  if (!ms) return () => {};

  const origGetCoords = ms.getCoords.bind(ms);
  const origGetReportCoords = ms.getMouseReportCoords.bind(ms);

  // getCoords drives selection: mousedown anchor, drag-extend, click/dblclick.
  ms.getCoords = (event, element, cols, rows, isSelection) => {
    const scale = getScale();
    if (scale === 1) return origGetCoords(event, element, cols, rows, isSelection);
    return origGetCoords(adjust(event, element, scale), element, cols, rows, isSelection);
  };

  // getMouseReportCoords drives the escape sequences sent to mouse-aware
  // TUIs (vim, htop, fzf). Same units mismatch, same fix.
  ms.getMouseReportCoords = (event, element) => {
    const scale = getScale();
    if (scale === 1) return origGetReportCoords(event, element);
    return origGetReportCoords(adjust(event, element, scale), element);
  };

  return () => {
    ms.getCoords = origGetCoords;
    ms.getMouseReportCoords = origGetReportCoords;
  };
}
