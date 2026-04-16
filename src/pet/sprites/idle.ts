import { C, _ } from "./colors";

// 24×24 capybara — refined side view facing right
// Improvements: dark back contour, inner ear, whisker dots, tail nub, toe marks

const idle0: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 1  ear tip
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.cheek,C.ear,_,_,_,_,_,_,_],  // 2  ear with inner color
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.bodyDark,_,_,_,_,_,_],  // 3  head top contour
  [_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 4  head
  [_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 5  head wider
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.eye,C.eyeShine,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_],  // 6  eye (pupil + shine)
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.cheek,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_],  // 7  cheek + snout
  [_,_,_,_,_,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyDark,C.bodyDark,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_],  // 8  back ridge + whisker dots + nose
  [_,_,_,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_,_],  // 9  body + nose
  [_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_],  // 10 body + lower snout
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.body,C.body,_,_,_,_,_],  // 11 body
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 12 body widest
  [_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_,_],  // 13 belly
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_,_],  // 14 belly
  [_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 15 belly
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 16 body bottom
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 17 tail nub + body
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_,_],  // 18 body bottom
  [_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 19 feet
  [_,_,_,_,C.feet,C.bodyDark,C.feet,_,_,_,_,C.feet,C.bodyDark,C.feet,_,_,_,_,_,_,_,_,_,_],  // 20 toes
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Breathing frame — whole sprite shifted up 1px
const idle1: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 0  ear (1px up)
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.cheek,C.ear,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.bodyDark,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.eye,C.eyeShine,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_],  // 5
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.cheek,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_],  // 6
  [_,_,_,_,_,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyDark,C.bodyDark,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_],  // 7
  [_,_,_,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_,_],  // 8
  [_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_],  // 9
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.body,C.body,_,_,_,_,_],  // 10
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 11
  [_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_,_],  // 12
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_,_],  // 13
  [_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 14
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 15
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 16
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_,_],  // 17
  [_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 18 feet (1px up)
  [_,_,_,_,C.feet,C.bodyDark,C.feet,_,_,_,_,C.feet,C.bodyDark,C.feet,_,_,_,_,_,_,_,_,_,_],  // 19 toes
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 20
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Blink frame — eye closed
const idle2: (string | null)[][] = idle0.map((row, y) => {
  if (y === 6) {
    return row.map((px) =>
      px === C.eye ? C.bodyDark : px === C.eyeShine ? C.body : px,
    );
  }
  return row;
});

export const idleFrames = [idle0, idle0, idle0, idle1, idle1, idle1, idle0, idle2, idle0];
