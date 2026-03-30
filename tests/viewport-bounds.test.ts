import test from "node:test";
import assert from "node:assert/strict";

import {
  canvasPointToScreenPoint,
  screenPointToCanvasPoint,
} from "../src/canvas/viewportBounds.ts";

test("screenPointToCanvasPoint accounts for the open left panel inset", () => {
  const point = screenPointToCanvasPoint(
    280,
    120,
    { x: 0, y: -20, scale: 2 },
    false,
    280,
  );

  assert.deepEqual(point, { x: 0, y: 70 });
});

test("canvasPointToScreenPoint offsets screen coordinates by the left panel inset", () => {
  const point = canvasPointToScreenPoint(
    24,
    70,
    { x: 10, y: -20, scale: 2 },
    false,
    280,
  );

  assert.deepEqual(point, { x: 338, y: 120 });
});

test("screen/canvas point conversion round-trips with a collapsed left panel", () => {
  const screenPoint = canvasPointToScreenPoint(
    150,
    90,
    { x: -40, y: 30, scale: 1.5 },
    true,
    280,
  );
  const canvasPoint = screenPointToCanvasPoint(
    screenPoint.x,
    screenPoint.y,
    { x: -40, y: 30, scale: 1.5 },
    true,
    280,
  );

  assert.deepEqual(canvasPoint, { x: 150, y: 90 });
});
