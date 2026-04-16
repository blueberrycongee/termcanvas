import { C, _ } from "./colors";

// 24×24 capybara — side view facing right, more expressive face:
//   - pink inner ear (was brown)
//   - permanent rosy cheek blush
//   - visible mouth pixel under the nose
//   - softer back contour with subtle tail definition
//   - deeper belly highlight with inner shadow band

const idle0: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],  // 0
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],  // 1  ear tip
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.earInner,C.ear,_,_,_,_,_,_,_],  // 2  ear with pink inner
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.bodyDark,_,_,_,_,_,_],  // 3  head top
  [_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],  // 4  head
  [_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],  // 5  head wider
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.eye,C.eyeShine,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_],  // 6  eye + shine
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.blush,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_],  // 7  rosy cheek + snout start
  [_,_,_,_,_,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyDark,C.bodyDark,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_],  // 8  back ridge + whisker dots + nose
  [_,_,_,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_,_],  // 9  body + nose tip
  [_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.mouth,C.body,_,_,_],  // 10 body + mouth pixel
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
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.ear,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,C.ear,C.earInner,C.ear,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.bodyDark,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.body,C.eye,C.eyeShine,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,C.bodyDark,C.body,C.blush,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_],
  [_,_,_,_,_,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyDark,C.bodyDark,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_],
  [_,_,_,C.bodyDark,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.nose,C.nose,_,_],
  [_,_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.mouth,C.body,_,_,_],
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.bodyLight,C.body,C.body,_,_,_,_,_],
  [_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_],
  [_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,C.body,_,_,_,_,_,_,_,_],
  [_,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,_,_,_,_,_,_,_,_,_],
  [_,C.body,C.body,C.body,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.bodyLight,C.body,C.body,_,_,_,_,_,_,_,_,_],
  [_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_],
  [_,C.bodyDark,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,C.body,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,C.feet,C.feet,C.feet,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,C.feet,C.bodyDark,C.feet,_,_,_,_,C.feet,C.bodyDark,C.feet,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

// Blink frame — eye closed (tiny line)
const idle2: (string | null)[][] = idle0.map((row, y) => {
  if (y === 6) {
    return row.map((px) =>
      px === C.eye ? C.eyeClosed : px === C.eyeShine ? C.eyeClosed : px,
    );
  }
  return row;
});

// Head-tilt frame — ear + head lean slightly back (shift head rows left by 1)
const idle3: (string | null)[][] = idle0.map((row, y) => {
  if (y >= 1 && y <= 7) return [...row.slice(1), _];
  return row;
});

// Cadence: neutral, neutral, breathing, breathing, neutral, blink, neutral, tilt, neutral
export const idleFrames = [
  idle0,
  idle0,
  idle1,
  idle1,
  idle0,
  idle2,
  idle0,
  idle3,
  idle0,
];
