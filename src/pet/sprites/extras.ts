import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Curious — head leaning forward (shift head rows right)
const curiousBase: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y >= 1 && y <= 11) {
    return [_, ...row.slice(0, 23)];
  }
  return row;
});

export const curiousFrames = [curiousBase, idleFrames[0], curiousBase];

// Waiting — tapping foot animation (back foot disappears briefly)
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

export const waitingFrames = [waitBase, waitBase, waitTap, waitBase];

// Commanding — capybara with a little commander hat
const commandBase: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y === 0) return [_,_,_,_,_,_,_,_,_,_,_,_,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,_,_,_,_,_];
  if (y === 1) return [_,_,_,_,_,_,_,_,_,_,_,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,C.hat,_,_,_,_,_];
  return row;
});

export const commandingFrames = [commandBase, commandBase, commandBase, commandBase];

// Confused — question mark rendered in overlay, idle body
const confusedBase = idleFrames[0];

export const confusedFrames = [confusedBase, confusedBase, confusedBase];

// Triumph — reuse celebrating frames
export { celebratingFrames as triumphFrames } from "./celebrating";

// Waking — stretch animation (alternate breathing poses)
export const wakingFrames = [idleFrames[3], idleFrames[0], idleFrames[3]];

// Goodbye — looking around (head leans forward and backward)
const goodbyeForward = curiousBase;
const goodbyeBack: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y >= 1 && y <= 11) {
    return [...row.slice(1), _];
  }
  return row;
});

export const goodbyeFrames = [goodbyeForward, idleFrames[0], goodbyeBack, idleFrames[0]];
