import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Curious — head tilted, ears perked
const curiousBase: (string | null)[][] = idleFrames[0].map((row, y) => {
  // Tilt head: shift top rows slightly right
  if (y >= 4 && y <= 12) {
    return [...row.slice(1), _];
  }
  return row;
});

export const curiousFrames = [curiousBase, idleFrames[0], curiousBase];

// Waiting — tapping foot animation (reuse idle body, animate feet)
const waitBase = idleFrames[0];
const waitTap: (string | null)[][] = waitBase.map((row, y) => {
  if (y === 20) {
    // Left foot taps (disappears briefly)
    return [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_];
  }
  if (y === 21) {
    return [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_];
  }
  return row;
});

export const waitingFrames = [waitBase, waitBase, waitTap, waitBase];

// Commanding — capybara with a little commander hat
const commandBase: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y === 2) return [_,_,_,_,_,_,_,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,_,_,_,_,_,_,_,_];
  if (y === 3) return [_,_,_,_,_,_,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,_,_,_,_,_,_,_];
  return row;
});

export const commandingFrames = [commandBase, commandBase, commandBase, commandBase];

// Confused — question mark effect, head scratch
const confusedBase = idleFrames[0];

export const confusedFrames = [confusedBase, confusedBase, confusedBase];

// Triumph — same as celebrating but longer, reuse celebrating frames
export { celebratingFrames as triumphFrames } from "./celebrating";

// Waking — stretch animation (reuse idle with slight vertical stretch)
export const wakingFrames = [idleFrames[1], idleFrames[0], idleFrames[1]];

// Goodbye — waving (simple head tilt alternation)
const goodbyeLeft = curiousBase;
const goodbyeRight: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y >= 4 && y <= 12) {
    return [_, ...row.slice(0, 23)];
  }
  return row;
});

export const goodbyeFrames = [goodbyeLeft, idleFrames[0], goodbyeRight, idleFrames[0]];
