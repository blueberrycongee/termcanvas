import test from "node:test";
import assert from "node:assert/strict";
import { calculateOverlayPosition, isInViewport } from "../src/terminal/smartRender/overlayPosition.ts";

test("calculates correct top position from segment start line", () => {
  const pos = calculateOverlayPosition({
    segmentStartLine: 10,
    segmentLineCount: 5,
    viewportY: 5,
    cellHeight: 20,
    cellWidth: 10,
    viewportCols: 80,
    padding: 4,
  });
  assert.equal(pos.top, 100);
  assert.equal(pos.height, 100);
});

test("returns negative top for segments above viewport", () => {
  const pos = calculateOverlayPosition({
    segmentStartLine: 0,
    segmentLineCount: 3,
    viewportY: 10,
    cellHeight: 20,
    cellWidth: 10,
    viewportCols: 80,
    padding: 4,
  });
  assert.ok(pos.top < 0);
});

test("isInViewport returns true for visible segments", () => {
  assert.equal(isInViewport(10, 5, 5, 30, 50), true);
});

test("isInViewport returns false for segments far above", () => {
  assert.equal(isInViewport(0, 3, 100, 30, 50), false);
});

test("isInViewport respects buffer margin", () => {
  assert.equal(isInViewport(5, 3, 60, 30, 50), false);
  assert.equal(isInViewport(50, 3, 60, 30, 50), true);
});
