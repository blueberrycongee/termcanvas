import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Working capybara — determined expression, slight forward lean

const work0: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y === 6) {
    // Determined eyes — wider (2px) + no shine
    return row.map((px, x) =>
      px === C.eye ? C.eye :
      px === C.eyeShine ? C.eye : // shine becomes second eye pixel
      px,
    );
  }
  return row;
});

// Typing — head leans forward (shift head rows right by 1px)
const work1: (string | null)[][] = work0.map((row, y) => {
  if (y >= 1 && y <= 11) {
    return [_, ...row.slice(0, 23)];
  }
  return row;
});

export const workingFrames = [work0, work0, work1, work1];
