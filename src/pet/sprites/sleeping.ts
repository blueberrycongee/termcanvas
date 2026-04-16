import { C, _ } from "./colors";

// Sleeping capybara — curled up on its belly, eyes shut, soft breathing motion.

const sleepBase: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 5
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 6
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_],  // 7  ear tip
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.earInner,C.ear,_,_,_,_,_,_,_,_],  // 8  pink inner
  [_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 9  head top
  [_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 10 head
  [_,_,_,_,_,_,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.body,C.blush,C.eyeClosed,C.eyeClosed,C.body,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_],  // 11 body + closed eye + blush
  [_,_,_,_,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,C.nose,_,_,_,_],  // 12 body + snout + nose
  [_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.mouth,_,_,_,_,_],  // 13 body + mouth
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

// Breathing frame — belly expands (one extra bodyLight pixel on each side)
const sleepBreath: (string | null)[][] = sleepBase.map((row, y) => {
  if (y === 14) {
    return [_,_,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_];
  }
  if (y === 15) {
    return [_,_,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_];
  }
  return row;
});

// Cadence: slow in / out breathing
export const sleepingFrames = [sleepBase, sleepBase, sleepBreath, sleepBreath];

export const zzzOffsets = [
  { dx: 16, dy: -8 },
  { dx: 18, dy: -14 },
  { dx: 20, dy: -20 },
];
