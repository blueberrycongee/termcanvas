import test from "node:test";
import assert from "node:assert/strict";

import {
  easeInOutCubic,
  getViewportAnimationDuration,
} from "../src/utils/canvasAnimation.ts";

test("viewport animation keeps short focus hops responsive", () => {
  const duration = getViewportAnimationDuration({
    startX: 0,
    startY: 0,
    startScale: 1,
    targetX: 120,
    targetY: 0,
    targetScale: 1,
  });

  assert.equal(duration, 229.6);
});

test("viewport animation slows down long wrap jumps", () => {
  const duration = getViewportAnimationDuration({
    startX: 0,
    startY: 0,
    startScale: 1,
    targetX: 1296,
    targetY: 488,
    targetScale: 1,
  });

  assert.ok(duration > 320);
  assert.ok(duration < 340);
});

test("viewport animation caps very large moves", () => {
  const duration = getViewportAnimationDuration({
    startX: 0,
    startY: 0,
    startScale: 1,
    targetX: 6000,
    targetY: 4000,
    targetScale: 0.35,
  });

  assert.equal(duration, 520);
});

test("easeInOutCubic starts and ends exactly on the viewport endpoints", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
});
