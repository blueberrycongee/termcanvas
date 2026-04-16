import { C, _ } from "./colors";
import { idleFrames } from "./idle";

// Working capybara — concentrated stare (wide pupil), neutral face, slight forward lean.

const work0: (string | null)[][] = idleFrames[0].map((row, y) => {
  if (y === 6) {
    // Determined eyes — 2px pupil (no shine)
    return row.map((px) => (px === C.eyeShine ? C.eye : px));
  }
  if (y === 7) {
    // Drop the rosy blush — focused, not happy
    return row.map((px) => (px === C.blush ? C.body : px));
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
