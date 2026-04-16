import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Walking capybara — same refined body, alternating leg stride

const baseBody = idleFrames[0];

const walk0: (string | null)[][] = baseBody.map((row, y) => {
  if (y === 19) return [_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_]; // back foot back, front foot forward
  if (y === 20) return [_,_,_,_,C.feet,C.feet,_,_,_,_,_,_,_,C.feet,C.feet,_,_,_,_,_,_,_,_,_];
  return row;
});

const walk1: (string | null)[][] = baseBody.map((row, y) => {
  if (y === 19) return [_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_]; // back foot forward, front foot back
  if (y === 20) return [_,_,_,_,_,_,C.feet,C.feet,_,_,_,_,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_];
  return row;
});

export const walkingFrames = [walk0, walk0, walk1, walk1];
