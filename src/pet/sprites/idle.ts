import { C, _ } from "./colors";

// 24×24 capybara — side view facing right, idle breathing animation
// Silhouette: horizontal barrel body, small head with elongated snout, tiny ears, short legs

const idle0: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 4  tiny ear
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,C.body,_,_,_,_,_,_,_],  // 5  ear base + head start
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 6  head top
  [_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 7  head
  [_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.eye,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 8  eye high on head
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.cheek,C.eyeShine,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_],  // 9  body rise + cheek + snout
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,C.nose,_,_,_,_],  // 10 body + snout + nose
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,C.nose,_,_,_,_],  // 11 body + nose
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_],  // 12 lower face
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 13 body widest
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 14 belly
  [_,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_,_,_],  // 15 belly
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 16 belly
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 17 body bottom
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 18 body bottom
  [_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 19 feet (back + front)
  [_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 20 feet
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Breathing frame — whole sprite shifted up 1px
const idle1: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 3  ear (1px up)
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,C.body,_,_,_,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 5
  [_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 6
  [_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.eye,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 7
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.cheek,C.eyeShine,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_],  // 8
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,C.nose,_,_,_,_],  // 9
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,C.nose,_,_,_,_],  // 10
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_],  // 11
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 12
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 13
  [_,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_,_,_],  // 14
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 15
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 16
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 17
  [_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 18 feet (1px up)
  [_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 19
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 20
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Blink frame — eye closed
const idle2: (string | null)[][] = idle0.map((row, y) => {
  if (y === 8) {
    return row.map((px) => (px === C.eye ? C.bodyDark : px));
  }
  if (y === 9) {
    return row.map((px) => (px === C.eyeShine ? C.body : px));
  }
  return row;
});

export const idleFrames = [idle0, idle0, idle0, idle1, idle1, idle1, idle0, idle2, idle0];
