// Shared timing / easing for left-panel and right-panel expand-collapse.
//
// The same curve drives four things that must stay in lockstep while a
// sidebar is toggling; if any one of them uses a different duration or
// easing, the focused terminal ends up drifting / wobbling horizontally:
//
//   1. `width` transition on the panel itself (LeftPanel / RightPanel)
//   2. `left` transition on the canvas container (XyFlowCanvas)
//   3. `left` / `width` transition on the drawing layer (DrawingLayer)
//   4. viewport pan + scale animation from `animateTo` when the panel
//      toggle useEffect calls `panToTerminal`
//
// `cubicBezier(...)` below returns a JS easing function with the same
// shape as the CSS `cubic-bezier(...)` string, so the rAF-driven viewport
// animation exactly tracks the CSS-driven panel / canvas animations.
//
// Keeping them coupled means the terminal visually stays put (like it
// already does for right-panel toggles); the user only sees the
// "shrink / grow" part of the animation.

export const PANEL_TRANSITION_DURATION_MS = 240;

const PANEL_BEZIER_P1X = 0.22;
const PANEL_BEZIER_P1Y = 0.61;
const PANEL_BEZIER_P2X = 0.36;
const PANEL_BEZIER_P2Y = 1;

export const PANEL_TRANSITION_EASING_CSS = `cubic-bezier(${PANEL_BEZIER_P1X}, ${PANEL_BEZIER_P1Y}, ${PANEL_BEZIER_P2X}, ${PANEL_BEZIER_P2Y})`;

// Newton's method cubic-bezier(x) -> y solver. Good enough for animation
// timing (converges in <=4 iterations for the curves we use here).
function makeCubicBezierEasing(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): (x: number) => number {
  const bezier = (t: number, p1: number, p2: number) =>
    3 * (1 - t) * (1 - t) * t * p1 +
    3 * (1 - t) * t * t * p2 +
    t * t * t;
  const bezierDeriv = (t: number, p1: number, p2: number) =>
    3 * (1 - t) * (1 - t) * p1 +
    6 * (1 - t) * t * (p2 - p1) +
    3 * t * t * (1 - p2);

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const bx = bezier(t, p1x, p2x);
      const diff = bx - x;
      if (Math.abs(diff) < 1e-4) break;
      const dbx = bezierDeriv(t, p1x, p2x);
      if (Math.abs(dbx) < 1e-6) break;
      t -= diff / dbx;
    }
    return bezier(t, p1y, p2y);
  };
}

export const PANEL_TRANSITION_EASING_FN = makeCubicBezierEasing(
  PANEL_BEZIER_P1X,
  PANEL_BEZIER_P1Y,
  PANEL_BEZIER_P2X,
  PANEL_BEZIER_P2Y,
);
