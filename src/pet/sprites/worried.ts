import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Worried capybara — wide eyes, sweat drops, trembling

const worried0: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y === 5) {
    // Sweat drop above head
    const r = [...row];
    r[22] = C.sweat;
    return r;
  }
  if (y === 6) {
    // Worried wide eyes (2px) + sweat
    const r = row.map((px) =>
      px === C.eyeShine ? C.eye : px, // shine → second eye pixel
    );
    r[22] = C.sweat;
    return r;
  }
  return row;
});

// Tremble — shift 1px right
const worried1: (string | null)[][] = worried0.map((row) => [_, ...row.slice(0, 23)]);

// Tremble — shift 1px left
const worried2: (string | null)[][] = worried0.map((row) => [...row.slice(1), _]);

export const worriedFrames = [worried0, worried1, worried0, worried2];
