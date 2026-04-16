import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Walking capybara — inherits the idle body; alternating leg stride with bob.

const baseBody = idleFrames[0];

// Stride A: back leg back, front leg forward
const walk0: (string | null)[][] = baseBody.map((row, y) => {
  if (y === 19) return [_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_];
  if (y === 20) return [_,_,_,_,C.feet,C.bodyDark,_,_,_,_,_,_,_,C.feet,C.bodyDark,_,_,_,_,_,_,_,_,_];
  return row;
});

// Mid-stride: legs gathered under body + subtle 1px body bob up
const walkMid: (string | null)[][] = baseBody.map((row, y) => {
  if (y > 0 && y <= 18) return baseBody[y - 1];
  if (y === 19) return [_,_,_,_,C.feet,C.feet,_,_,_,_,_,_,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_];
  if (y === 20) return [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_];
  return row;
});

// Stride B: back leg forward, front leg back
const walk1: (string | null)[][] = baseBody.map((row, y) => {
  if (y === 19) return [_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_];
  if (y === 20) return [_,_,_,_,_,_,C.feet,C.bodyDark,_,_,_,_,C.feet,C.bodyDark,_,_,_,_,_,_,_,_,_,_];
  return row;
});

export const walkingFrames = [walk0, walkMid, walk1, walkMid];
