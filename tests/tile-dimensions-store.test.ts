import test from "node:test";
import assert from "node:assert/strict";

import { computeTileDimensions } from "../src/stores/tileDimensionsStore.ts";

test("computeTileDimensions returns reasonable dims for default viewport", () => {
  const result = computeTileDimensions(1920, 1080, 32, 32);
  assert.ok(result.w > 600 && result.w < 800, `w=${result.w} should be 600-800`);
  assert.ok(result.h > 350 && result.h < 500, `h=${result.h} should be 350-500`);
});

test("computeTileDimensions adapts to narrow viewport (left panel open)", () => {
  const wide = computeTileDimensions(1920, 1080, 32, 32);
  const narrow = computeTileDimensions(1920, 1080, 480, 32);
  assert.ok(narrow.w < wide.w, "narrower viewport should produce smaller W");
  assert.ok(narrow.h > wide.h, "narrower viewport should produce taller H");
});

test("computeTileDimensions preserves area", () => {
  const TARGET_AREA = 640 * 480;
  const result = computeTileDimensions(1920, 1080, 280, 32);
  const area = result.w * result.h;
  assert.ok(
    Math.abs(area - TARGET_AREA) < 500,
    `area=${area} should be ≈${TARGET_AREA}`,
  );
});

test("computeTileDimensions clamps to min/max bounds", () => {
  const narrow = computeTileDimensions(600, 1080, 32, 32);
  assert.ok(narrow.w >= 400, `w=${narrow.w} should be >= 400`);
  assert.ok(narrow.h <= 700, `h=${narrow.h} should be <= 700`);

  const wide = computeTileDimensions(3840, 600, 32, 32);
  assert.ok(wide.w <= 900, `w=${wide.w} should be <= 900`);
  assert.ok(wide.h >= 300, `h=${wide.h} should be >= 300`);
});

test("computeTileDimensions handles zero-width gracefully", () => {
  const result = computeTileDimensions(400, 1080, 500, 32);
  assert.ok(result.w >= 400, `w=${result.w} should be >= 400`);
  assert.ok(result.h >= 300, `h=${result.h} should be >= 300`);
});

test("computeTileDimensions is stable across similar inputs", () => {
  const a = computeTileDimensions(1920, 1080, 280, 32);
  const b = computeTileDimensions(1920, 1080, 282, 32);
  assert.ok(Math.abs(a.w - b.w) < 5, "small input change should produce small output change");
  assert.ok(Math.abs(a.h - b.h) < 5, "small input change should produce small output change");
});
