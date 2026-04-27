import { useEffect } from "react";
import { useCanvasStore } from "../stores/canvasStore";

/**
 * Compensate xterm hit-testing for the canvas-level CSS scale transform.
 *
 * The bug
 * -------
 * React Flow's viewport applies `transform: scale(s)` to its content. xterm
 * hit-tests by:
 *
 *     col = ceil((clientX - screenRect.left) / cell_CSS)
 *
 * - `clientX - screenRect.left` is **visual** pixels (rect is post-transform)
 * - `cell_CSS` is the **unscaled** cell width cached in
 *   `_renderService.dimensions.css.cell`
 *
 * Visual and unscaled don't match; the two units mix and the column you land
 * on is `ceil(N * s)` instead of `N`. At any scale != 1 the offset grows with
 * distance from the screen's left edge.
 *
 * The fix
 * -------
 * Intercept mouse events at window capture, re-dispatch a synthetic event
 * whose offset from the screen rect equals the unscaled distance the user
 * really aimed at:
 *
 *     correctedClientX = rect.left + (clientX - rect.left) / scale
 *
 * xterm's downstream math then produces the right column.
 *
 * Why window capture
 * ------------------
 * React Flow's pane installs a capture-phase mousedown handler that calls
 * `stopPropagation`, which means a listener on the tile's containerEl
 * never sees the event. The same workaround is used by `ContextMenu` and
 * `ClusterToolbar` (see those comments). Window-capture puts us at the top
 * of the chain, before React Flow has a chance to swallow the event.
 *
 * The handler scopes itself by `containerEl.contains(e.target)`.
 */
const MOUSE_EVENT_TYPES = [
  "mousedown",
  "mousemove",
  "mouseup",
  "click",
  "dblclick",
] as const;

export function useXtermClickZoomCorrection(
  containerEl: HTMLDivElement | null,
  active: boolean,
): void {
  useEffect(() => {
    if (!containerEl || !active) return;

    const corrected = new WeakSet<Event>();

    const handler = (e: Event) => {
      if (!(e instanceof MouseEvent)) return;
      if (corrected.has(e)) return;
      if (!(e.target instanceof Node) || !containerEl.contains(e.target)) {
        return;
      }
      // Skip while the user is dragging to pan — xterm hit-testing isn't
      // relevant, and the per-frame getBoundingClientRect() costs layout.
      if (document.body.classList.contains("tc-canvas-pan-grabbing")) return;

      const { scale } = useCanvasStore.getState().viewport;
      if (scale === 1) return;

      const xtermRoot = containerEl.querySelector(".xterm");
      const screenElement =
        containerEl.querySelector(".xterm-screen") ?? xtermRoot ?? containerEl;
      const rect = screenElement.getBoundingClientRect();
      const dispatchTarget =
        xtermRoot instanceof Element && xtermRoot.contains(e.target)
          ? e.target
          : (xtermRoot ?? containerEl);

      const adjusted = new MouseEvent(e.type, {
        altKey: e.altKey,
        bubbles: e.bubbles,
        button: e.button,
        buttons: e.buttons,
        cancelable: e.cancelable,
        clientX: rect.left + (e.clientX - rect.left) / scale,
        clientY: rect.top + (e.clientY - rect.top) / scale,
        ctrlKey: e.ctrlKey,
        detail: e.detail,
        metaKey: e.metaKey,
        screenX: e.screenX,
        screenY: e.screenY,
        shiftKey: e.shiftKey,
      });
      corrected.add(adjusted);
      e.stopPropagation();
      e.preventDefault();
      dispatchTarget.dispatchEvent(adjusted);
    };

    for (const type of MOUSE_EVENT_TYPES) {
      window.addEventListener(type, handler, true);
    }
    return () => {
      for (const type of MOUSE_EVENT_TYPES) {
        window.removeEventListener(type, handler, true);
      }
    };
  }, [containerEl, active]);
}
