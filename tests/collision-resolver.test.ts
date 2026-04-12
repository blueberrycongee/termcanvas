import test from "node:test";
import assert from "node:assert/strict";

interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

test("resolveCollisions pushes overlapping tiles apart", async () => {
  const { resolveCollisions } = await import(
    "../src/canvas/collisionResolver.ts"
  );

  const rects: Rect[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 50, y: 50, width: 100, height: 100 },
  ];

  const result = resolveCollisions(rects, 8);
  const a = result.find((entry) => entry.id === "a");
  const b = result.find((entry) => entry.id === "b");
  assert.ok(a && b);

  const overlapX = a.x < b.x + b.width + 8 && a.x + a.width + 8 > b.x;
  const overlapY = a.y < b.y + b.height + 8 && a.y + a.height + 8 > b.y;
  assert.ok(!(overlapX && overlapY), "tiles should not overlap after resolution");
});

test("resolveCollisions does nothing when no overlap", async () => {
  const { resolveCollisions } = await import(
    "../src/canvas/collisionResolver.ts"
  );

  const rects: Rect[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 200, y: 200, width: 100, height: 100 },
  ];

  const result = resolveCollisions(rects, 8);
  assert.deepEqual(result, rects);
});

test("resolveCollisions anchors the dragged tile", async () => {
  const { resolveCollisions } = await import(
    "../src/canvas/collisionResolver.ts"
  );

  const rects: Rect[] = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 50, y: 50, width: 100, height: 100 },
  ];

  const result = resolveCollisions(rects, 8, "b");
  const b = result.find((entry) => entry.id === "b");
  assert.ok(b);
  assert.equal(b.x, 50);
  assert.equal(b.y, 50);
});
