import test from "node:test";
import assert from "node:assert/strict";
import {
  getDrawingElementBounds,
  translateDrawingElement,
} from "../src/canvas/drawingGeometry.ts";

test("getDrawingElementBounds includes pen stroke footprint", () => {
  const bounds = getDrawingElementBounds({
    id: "drawing-1",
    type: "pen",
    color: "#fff",
    size: 8,
    points: [
      { x: 10, y: 20 },
      { x: 30, y: 45 },
    ],
  });

  assert.deepEqual(bounds, {
    x: 6,
    y: 16,
    w: 28,
    h: 33,
  });
});

test("translateDrawingElement moves world-anchored annotations and geometry together", () => {
  const translated = translateDrawingElement(
    {
      id: "drawing-2",
      type: "rect",
      x: 20,
      y: 30,
      w: 80,
      h: 40,
      color: "#fff",
      strokeWidth: 2,
      anchor: {
        kind: "world",
        position: { x: 20, y: 30 },
      },
    },
    15,
    -5,
  );

  assert.deepEqual(translated, {
    id: "drawing-2",
    type: "rect",
    x: 35,
    y: 25,
    w: 80,
    h: 40,
    color: "#fff",
    strokeWidth: 2,
    anchor: {
      kind: "world",
      position: { x: 35, y: 25 },
    },
  });
});

test("translateDrawingElement updates entity anchor offsets", () => {
  const translated = translateDrawingElement(
    {
      id: "drawing-3",
      type: "text",
      x: 12,
      y: 18,
      content: "hello",
      color: "#fff",
      fontSize: 14,
      anchor: {
        kind: "entity",
        entityId: "terminal-1",
        offset: { x: 12, y: 18 },
      },
    },
    -2,
    6,
  );

  assert.deepEqual(translated, {
    id: "drawing-3",
    type: "text",
    x: 10,
    y: 24,
    content: "hello",
    color: "#fff",
    fontSize: 14,
    anchor: {
      kind: "entity",
      entityId: "terminal-1",
      offset: { x: 10, y: 24 },
    },
  });
});
