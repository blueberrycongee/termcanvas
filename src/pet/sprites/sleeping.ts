import { C, _ } from "./colors";

// Sleeping capybara — lying down, compact, refined (side view)

const sleepBase: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 5
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 6
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_],  // 7  ear
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.cheek,C.ear,_,_,_,_,_,_,_,_],  // 8  ear inner
  [_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 9  head top
  [_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 10 head
  [_,_,_,_,_,_,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.body,C.body,C.bodyDark,C.bodyDark,C.body,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_],  // 11 body + closed eyes + snout
  [_,_,_,_,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,C.nose,_,_,_,_],  // 12 body + snout + nose
  [_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,_,_,_,_,_],  // 13 body
  [_,_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 14 belly
  [_,_,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 15 belly
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 16 body bottom
  [_,C.bodyDark,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_,_],  // 17 tail + body
  [_,_,_,_,_,C.feet,C.feet,_,_,_,_,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_,_],  // 18 tucked feet
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 19
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 20
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

export const sleepingFrames = [sleepBase, sleepBase];

export const zzzOffsets = [
  { dx: 16, dy: -8 },
  { dx: 18, dy: -14 },
  { dx: 20, dy: -20 },
];
