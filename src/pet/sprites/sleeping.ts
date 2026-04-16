import { C, _ } from "./colors";

// Sleeping capybara — lying down, compact pose, eyes closed (side view)

const sleepBase: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 5
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 6
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 7
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 8
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_],  // 9  ear
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,C.body,_,_,_,_,_,_,_,_],  // 10 ear + head
  [_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 11 head
  [_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 12 head
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyDark,C.bodyDark,C.body,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_],  // 13 body + closed eyes + snout
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,C.nose,_,_,_,_],  // 14 body + snout + nose
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,_,_,_,_,_],  // 15 body
  [_,_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 16 belly
  [_,_,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 17 belly
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 18 body bottom
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_,_],  // 19 body bottom
  [_,_,_,_,_,C.feet,C.feet,_,_,_,_,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_,_],  // 20 tucked feet
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

export const sleepingFrames = [sleepBase, sleepBase];

// Z positions for the floating Z animation (rendered separately in overlay)
export const zzzOffsets = [
  { dx: 16, dy: -8 },
  { dx: 18, dy: -14 },
  { dx: 20, dy: -20 },
];
