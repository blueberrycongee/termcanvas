import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Curious — head leaning forward (shift head rows right)
const curiousBase: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y >= 4 && y <= 12) {
    return [_, ...row.slice(0, 23)];
  }
  return row;
});

export const curiousFrames = [curiousBase, idleFrames[0], curiousBase];

// Waiting — tapping foot animation (reuse idle body, animate back foot)
const waitBase = idleFrames[0];
const waitTap: (string | null)[][] = waitBase.map((row, y) => {
  if (y === 19) {
    // Back foot disappears briefly (tap up)
    return [_,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_];
  }
  if (y === 20) {
    return [_,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_];
  }
  return row;
});

export const waitingFrames = [waitBase, waitBase, waitTap, waitBase];

// Commanding — capybara with a little commander hat (above head)
const commandBase: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y === 2) return [_,_,_,_,_,_,_,_,_,_,_,_,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,_,_,_,_,_];
  if (y === 3) return [_,_,_,_,_,_,_,_,_,_,_,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,_,_,_,_,_];
  return row;
});

export const commandingFrames = [commandBase, commandBase, commandBase, commandBase];

// Confused — question mark effect (rendered in overlay), idle body
const confusedBase = idleFrames[0];

export const confusedFrames = [confusedBase, confusedBase, confusedBase];

// Triumph — same as celebrating but longer, reuse celebrating frames
export { celebratingFrames as triumphFrames } from "./celebrating";

// Waking — stretch animation (alternate between breathing poses)
export const wakingFrames = [idleFrames[3], idleFrames[0], idleFrames[3]];

// Goodbye — looking around (head leans forward and backward)
const goodbyeForward = curiousBase;
const goodbyeBack: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y >= 4 && y <= 12) {
    return [...row.slice(1), _];
  }
  return row;
});

export const goodbyeFrames = [goodbyeForward, idleFrames[0], goodbyeBack, idleFrames[0]];
