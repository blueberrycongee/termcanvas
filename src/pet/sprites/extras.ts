import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Curious — head leaning forward (shift head rows right by 1)
const curiousBase: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y >= 1 && y <= 11) {
    return [_, ...row.slice(0, 23)];
  }
  return row;
});

// Curious, big alert eye variant
const curiousAlert: (string | null)[][] = curiousBase.map((row, y) => {
  if (y === 6) {
    // Slightly bigger eye on alert — shine below pupil
    return row.map((px) => (px === C.eyeShine ? C.eye : px));
  }
  return row;
});

export const curiousFrames = [curiousBase, curiousAlert, curiousBase];

// Waiting — tapping foot animation (back foot lifts briefly)
const waitBase = idleFrames[0];
const waitTap: (string | null)[][] = waitBase.map((row, y) => {
  if (y === 19) {
    return [_,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_]; // only front foot
  }
  if (y === 20) {
    return [_,_,_,_,_,_,_,_,_,_,_,C.feet,C.bodyDark,C.feet,_,_,_,_,_,_,_,_,_,_];
  }
  return row;
});
const waitTapHigh: (string | null)[][] = waitBase.map((row, y) => {
  if (y === 18) {
    return [_,_,_,_,C.feet,C.feet,C.feet,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_]; // back foot raised higher
  }
  if (y === 19) {
    return [_,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_];
  }
  if (y === 20) {
    return [_,_,_,_,_,_,_,_,_,_,_,C.feet,C.bodyDark,C.feet,_,_,_,_,_,_,_,_,_,_];
  }
  return row;
});

export const waitingFrames = [waitBase, waitBase, waitTap, waitTapHigh, waitTap, waitBase];

// Commanding — capybara in a commander's cap (2-tone + brim)
const commandBase: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y === 0) return [_,_,_,_,_,_,_,_,_,_,_,_,C.hatDark,C.hat,C.hat,C.hat,C.hat,C.hat,C.hatDark,_,_,_,_,_];
  if (y === 1) return [_,_,_,_,_,_,_,_,_,_,_,C.hatDark,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hatDark,_,_,_,_]; // brim
  // Replace the ear row where it would be hidden under the cap with body
  if (y === 2) {
    return row.map((px, x) => {
      if (x >= 14 && x <= 16 && (px === C.ear || px === C.earInner)) return C.body;
      return px;
    });
  }
  return row;
});

export const commandingFrames = [commandBase, commandBase, commandBase, commandBase];

// Confused — question mark rendered in overlay, idle body, slight head lean
const confusedLean: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y >= 1 && y <= 7) return [...row.slice(1), _];
  return row;
});
export const confusedFrames = [idleFrames[0], confusedLean, idleFrames[0], confusedLean];

// Triumph — reuse celebrating frames
export { celebratingFrames as triumphFrames } from "./celebrating";

// Waking — long slow stretch (rise, stretch, settle)
const stretchBase = idleFrames[1];
const stretchFull: (string | null)[][] = stretchBase.map((row, y) => {
  // Expand head forward one pixel during max-stretch
  if (y >= 3 && y <= 10) return [...row.slice(1), _];
  return row;
});
export const wakingFrames = [stretchBase, stretchFull, stretchFull, stretchBase, idleFrames[0]];
