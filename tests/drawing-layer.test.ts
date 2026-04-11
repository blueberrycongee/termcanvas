import test from "node:test";
import assert from "node:assert/strict";

import { getDrawingLayerViewportSize } from "../src/canvas/DrawingLayer.tsx";

test("getDrawingLayerViewportSize spans the canvas viewport between side panels", () => {
  const size = getDrawingLayerViewportSize(32, 240, 1440, 900);

  assert.deepEqual(size, {
    width: 1168,
    height: 900,
  });
});

test("getDrawingLayerViewportSize clamps negative width to zero", () => {
  const size = getDrawingLayerViewportSize(900, 900, 1200, 800);

  assert.deepEqual(size, {
    width: 0,
    height: 800,
  });
});
