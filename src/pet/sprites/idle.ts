import { C, _ } from "./colors";

// 24×24 capybara — idle breathing animation
// Body shape: round, stubby legs, small ears on top, dot eyes, big nose

const idle0: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 3
  [_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_],  // 4  ears
  [_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_],  // 5
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 6  head top
  [_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 7
  [_,_,_,_,C.body,C.body,C.eye,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.eye,C.body,C.body,C.body,_,_,_,_,_],  // 8  eyes
  [_,_,_,_,C.body,C.body,C.eyeShine,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.eyeShine,C.body,C.body,C.body,_,_,_,_,_],  // 9  eye shine + snout
  [_,_,_,_,C.body,C.cheek,C.body,C.body,C.bodyLight,C.bodyLight,C.nose,C.nose,C.nose,C.bodyLight,C.bodyLight,C.body,C.body,C.cheek,C.body,_,_,_,_,_],  // 10 nose + cheeks
  [_,_,_,_,_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_],  // 11 lower face
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 12 chin
  [_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 13 body top
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 14
  [_,_,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,_,_,_],  // 15 belly
  [_,_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_],  // 16
  [_,_,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,_,_,_],  // 17
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 18 lower body
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 19
  [_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_],  // 20 feet
  [_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Breathing frame — body slightly raised
const idle1: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_],  // 3  ears (1px up)
  [_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_],  // 4
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 5  head (1px up)
  [_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 6
  [_,_,_,_,C.body,C.body,C.eye,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.eye,C.body,C.body,C.body,_,_,_,_,_],  // 7  eyes
  [_,_,_,_,C.body,C.body,C.eyeShine,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.eyeShine,C.body,C.body,C.body,_,_,_,_,_],  // 8
  [_,_,_,_,C.body,C.cheek,C.body,C.body,C.bodyLight,C.bodyLight,C.nose,C.nose,C.nose,C.bodyLight,C.bodyLight,C.body,C.body,C.cheek,C.body,_,_,_,_,_],  // 9  nose + cheeks
  [_,_,_,_,_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_],  // 10
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],  // 11
  [_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 12 body
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 13
  [_,_,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,_,_,_],  // 14 belly
  [_,_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_],  // 15
  [_,_,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,_,_,_],  // 16
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 17
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 18
  [_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_],  // 19 feet (1px up)
  [_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_],  // 20
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Blink frame — eyes closed
const idle2: (string | null)[][] = idle0.map((row, y) => {
  if (y === 8) {
    // Replace eye pixels with body color (closed eyes = horizontal line)
    return row.map((px, x) => (px === C.eye ? C.bodyDark : px));
  }
  if (y === 9) {
    return row.map((px, x) => (px === C.eyeShine ? C.body : px));
  }
  return row;
});

export const idleFrames = [idle0, idle0, idle0, idle1, idle1, idle1, idle0, idle2, idle0];
