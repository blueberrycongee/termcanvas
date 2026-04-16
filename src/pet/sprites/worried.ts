import { C, _ } from "./colors";

// Worried capybara — trembling with sweat drops (side view facing right)

const worried0: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 1
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 2
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 3
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 4
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,C.body,_,_,_,_,_,_,_],  // 5
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 6
  [_,_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,C.sweat,_,_],  // 7  sweat!
  [_,_,_,_,_,_,_,_,_,_,_,C.body,C.body,C.eye,C.eye,C.body,C.body,C.body,C.body,C.body,_,C.sweat,_,_],  // 8  worried wide eyes
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.eyeShine,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_],  // 9
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,C.nose,_,_,_,_],  // 10
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.nose,C.nose,_,_,_,_],  // 11
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_],  // 12
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],  // 13
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 14
  [_,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_,_,_],  // 15
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 16
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],  // 17
  [_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],  // 18
  [_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 19
  [_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],  // 20
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 21
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 22
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 23
];

// Tremble — shift 1px right
const worried1: (string | null)[][] = worried0.map((row) => [_, ...row.slice(0, 23)]);

// Tremble — shift 1px left
const worried2: (string | null)[][] = worried0.map((row) => [...row.slice(1), _]);

export const worriedFrames = [worried0, worried1, worried0, worried2];
