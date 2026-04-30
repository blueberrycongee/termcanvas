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
 * Patch xterm's private mouse hit-test paths so every event has its
 * coordinates pre-scaled back into CSS layout space before xterm compares it
 * with unscaled renderer dimensions:
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
 * 1. We reach into `terminal._core._mouseService` and
 *    `terminal._core._selectionService`, which are private. If a
 *    future xterm release renames or restructures these internals the patch
 *    becomes a no-op (defensive null-check returns the empty disposer). Bump
 *    of `@xterm/xterm` → re-verify this path.
 * 2. We add one extra `getBoundingClientRect()` per mouse event when scale ≠ 1.
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

type SelectionServiceLike = {
  _screenElement?: HTMLElement;
  _getMouseEventScrollAmount?: (event: MouseEventCoords) => number;
};

type XtermInternals = {
  _core?: {
    _mouseService?: MouseServiceLike;
    _selectionService?: SelectionServiceLike;
  };
};

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
  const selectionService = core?._selectionService;
  const disposers: Array<() => void> = [];

  if (ms) {
    const origGetCoords = ms.getCoords;
    const origGetReportCoords = ms.getMouseReportCoords;

    // getCoords drives selection: mousedown anchor, drag-extend, click/dblclick.
    ms.getCoords = (event, element, cols, rows, isSelection) => {
      const scale = getScale();
      if (scale === 1) {
        return origGetCoords.call(ms, event, element, cols, rows, isSelection);
      }
      return origGetCoords.call(
        ms,
        adjust(event, element, scale),
        element,
        cols,
        rows,
        isSelection,
      );
    };

    // getMouseReportCoords drives the escape sequences sent to mouse-aware
    // TUIs (vim, htop, fzf). Same units mismatch, same fix.
    ms.getMouseReportCoords = (event, element) => {
      const scale = getScale();
      if (scale === 1) return origGetReportCoords.call(ms, event, element);
      return origGetReportCoords.call(ms, adjust(event, element, scale), element);
    };

    disposers.push(() => {
      ms.getCoords = origGetCoords;
      ms.getMouseReportCoords = origGetReportCoords;
    });
  }

  const origGetScrollAmount = selectionService?._getMouseEventScrollAmount;
  if (selectionService && origGetScrollAmount) {
    // This is the easy path to miss: drag-selecting near the terminal edge
    // asks SelectionService whether to start auto-scroll. That private helper
    // does not call MouseService, so the selection endpoint and edge threshold
    // must both be patched here or they will disagree under React Flow zoom.
    selectionService._getMouseEventScrollAmount = (event) => {
      const scale = getScale();
      const screenElement = selectionService._screenElement;
      if (scale === 1 || !screenElement) {
        return origGetScrollAmount.call(selectionService, event);
      }
      return origGetScrollAmount.call(
        selectionService,
        adjust(event, screenElement, scale),
      );
    };

    disposers.push(() => {
      selectionService._getMouseEventScrollAmount = origGetScrollAmount;
    });
  }

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
