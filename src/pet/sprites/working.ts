import { C, _ } from "./colors";

// Working capybara — typing/hammering animation, focused expression

const work0: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_],
  [_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_],
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],
  [_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],
  [_,_,_,_,C.body,C.body,C.eye,C.eye,C.body,C.body,C.body,C.body,C.body,C.body,C.eye,C.eye,C.body,C.body,C.body,_,_,_,_,_],  // determined eyes (wider)
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],
  [_,_,_,_,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.nose,C.nose,C.nose,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,_,_,_,_,_],
  [_,_,_,_,_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_],
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],
  [_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],
  [_,_,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,_,_,_],
  [_,_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_],
  [_,_,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,_,_,_],
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],
  [_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_],
  [_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

// Typing — body tilts slightly forward
const work1: (string | null)[][] = work0.map((row, y) => {
  if (y >= 13 && y <= 19) {
    // Shift body 1px right for "leaning forward" effect
    return [_, ...row.slice(0, 23)];
  }
  return row;
});

export const workingFrames = [work0, work0, work1, work1];
