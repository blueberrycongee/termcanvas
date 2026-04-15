import { C, _ } from "./colors";

// Worried capybara — trembling with sweat drops

const worried0: (string | null)[][] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_],
  [_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_],
  [_,_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_],
  [_,_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],
  [_,_,_,_,C.body,C.body,C.eye,C.eye,C.body,C.body,C.body,C.body,C.body,C.body,C.eye,C.eye,C.body,C.body,C.body,_,_,_,_,_],  // worried eyes (wide)
  [_,_,_,_,C.body,C.body,C.eyeShine,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.eyeShine,C.body,C.body,C.body,_,C.sweat,_,_,_],  // sweat!
  [_,_,_,_,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.nose,C.nose,C.nose,C.bodyLight,C.bodyLight,C.body,C.body,C.body,C.body,_,C.sweat,_,_,_],
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

// Tremble — shift 1px right
const worried1: (string | null)[][] = worried0.map((row) => [_, ...row.slice(0, 23)]);

// Tremble — shift 1px left
const worried2: (string | null)[][] = worried0.map((row) => [...row.slice(1), _]);

export const worriedFrames = [worried0, worried1, worried0, worried2];
