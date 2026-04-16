import { C, _ } from "./colors";

// Celebrating capybara — joyful leap, closed-happy eye, bigger rosy blush, open smile.

const jump0: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 0  ears perked
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.earInner,C.ear,_,_,_,_,_,_,_],  // 1  pink inner
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.bodyDark,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.eyeClosed,C.eyeClosed,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_],  // 5  happy squint (^_^)
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.blush,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_],  // 6  big rosy blush
  [_,_,_,_,_,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.body,C.blush,C.body,C.bodyLight,C.bodyLight,C.bodyDark,C.bodyDark,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_],  // 7  extra blush
  [_,_,_,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.mouth,C.body,C.nose,C.nose,_,_],  // 8  open smile
  [_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.mouth,C.body,_,_,_],  // 9  lower mouth
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.body,C.body,_,_,_,_,_],  // 10
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 11
  [_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_,_],  // 12
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_,_],  // 13
  [_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 14
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 15
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 16
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 17 feet tucked up (airborne!)
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 18
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 19
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 20
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Mid-leap — higher, bent legs tucked
const jump2: (string | null)[][] = jump0.map((row, y) => {
  // shift whole body up 1px for max-height frame
  const newRow = y > 0 ? jump0[y - 1] : row;
  return newRow;
});

// Landing frame — squished with wider feet (spring back)
const jump1: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.earInner,C.ear,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.bodyDark,_,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 5
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.eyeClosed,C.eyeClosed,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_],  // 6  happy squint
  [_,_,_,_,_,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.body,C.blush,C.body,C.bodyLight,C.bodyLight,C.bodyDark,C.bodyDark,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_],  // 7  blush
  [_,_,_,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.mouth,C.body,C.nose,C.nose,_,_],  // 8  smile
  [_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.mouth,C.body,_,_,_],  // 9
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.body,C.body,_,_,_,_,_],  // 10
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 11
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 12
  [C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 13  wider (squish)
  [C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_],  // 14
  [C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_],  // 15
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_],  // 16
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 17
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 18
  [_,_,_,C.feet,C.feet,C.feet,C.feet,_,_,_,C.feet,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 19 spread feet (squish)
  [_,_,_,C.feet,C.feet,C.feet,C.feet,_,_,_,C.feet,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 20
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Cadence: crouch → launch → peak → launch → landing → crouch
export const celebratingFrames = [jump0, jump2, jump2, jump0, jump1, jump1];

export const sparklePositions = [
  { dx: -4, dy: -6 },
  { dx: 20, dy: -4 },
  { dx: 24, dy: 8 },
  { dx: -2, dy: 10 },
  { dx: 10, dy: -10 },
];
