import { C, _ } from "./colors";

// Celebrating capybara — jumping with sparkles (side view facing right)

const jump0: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 2  ears raised higher
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,C.body,_,_,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 5
  [_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 6
  [_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.eye,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_],  // 7  happy squint
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.blush,C.body,C.body,C.bodyLight,C.bodyLight,C.nose,C.nose,C.body,C.body,_,_,_,_],  // 8  blushing!
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyDark,C.nose,C.nose,_,_,_,_],  // 9  smile
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_],  // 10
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 11
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 12
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 13
  [_,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_,_,_],  // 14
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 15
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 16
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_,_],  // 17
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 18 no feet (jumping!)
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 19
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 20
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Landing frame — feet back, slightly squished
const jump1: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,C.body,_,_,_,_,_,_,_],  // 5
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 6
  [_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 7
  [_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.eye,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_],  // 8  happy squint
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.blush,C.body,C.body,C.bodyLight,C.bodyLight,C.nose,C.nose,C.body,C.body,_,_,_,_],  // 9  blushing
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyDark,C.nose,C.nose,_,_,_,_],  // 10 smile
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_],  // 11
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 12
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 13
  [C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_,_],  // 14 wider (squish)
  [C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_,_],  // 15
  [C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 16
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_],  // 17
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 18
  [_,_,C.feet,C.feet,C.feet,C.feet,_,_,_,_,C.feet,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 19 wider feet (squish)
  [_,_,C.feet,C.feet,C.feet,C.feet,_,_,_,_,C.feet,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 20
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

export const celebratingFrames = [jump0, jump0, jump1, jump1, jump0, jump0];

// Sparkle positions relative to pet (rendered in overlay)
export const sparklePositions = [
  { dx: -4, dy: -6 },
  { dx: 20, dy: -4 },
  { dx: 24, dy: 8 },
  { dx: -2, dy: 10 },
];
