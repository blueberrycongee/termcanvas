import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Worried capybara — wide shocked eyes, sweat drop, no blush, downturned mouth, trembling.

const worried0: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y === 5) {
    // Sweat drop above head
    const r = [...row];
    r[21] = C.sweatDark;
    r[22] = C.sweat;
    return r;
  }
  if (y === 6) {
    // Wide worried eyes (eye + eye instead of eye + shine) + sweat tail
    const r = row.map((px) =>
      px === C.eyeShine ? C.eye : px,
    );
    r[22] = C.sweat;
    return r;
  }
  if (y === 7) {
    // Remove rosy blush — worried isn't happy
    return row.map((px) => (px === C.blush ? C.body : px));
  }
  if (y === 10) {
    // Downturned mouth — shift mouth pixel up one row to signal frown
    const r = row.map((px) => (px === C.mouth ? C.body : px));
    return r;
  }
  if (y === 9) {
    // Place mouth in a slightly sad position above the nose line
    const r = [...row];
    if (r[19] === C.bodyLight) r[19] = C.mouth;
    return r;
  }
  return row;
});

// Tremble — shift 1px right
const worried1: (string | null)[][] = worried0.map((row) => [_, ...row.slice(0, 23)]);

// Tremble — shift 1px left
const worried2: (string | null)[][] = worried0.map((row) => [...row.slice(1), _]);

export const worriedFrames = [worried0, worried1, worried0, worried2];
