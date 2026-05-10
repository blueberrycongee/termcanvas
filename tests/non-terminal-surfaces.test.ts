import test from "node:test";
import assert from "node:assert/strict";

import { createPetSurface } from "../src/render-surfaces/petSurface.ts";
import {
  createMonacoSurface,
  type MonacoEditorLike,
} from "../src/render-surfaces/monacoSurface.ts";
import { createCanvasSurface } from "../src/render-surfaces/canvasSurface.ts";

test("pet surface forceRepaint nudges the paint trigger", () => {
  let trigger = 0;
  const handle = createPetSurface({
    triggerPaint: () => {
      trigger += 1;
    },
    isMounted: () => true,
  });

  handle.surface.forceRepaint("test", "heavy");
  assert.equal(trigger, 1);
});

test("pet surface markPaint stamps lastPaintAt; getHealth gates visible on isMounted", () => {
  let mounted = true;
  const handle = createPetSurface({
    triggerPaint: () => {},
    isMounted: () => mounted,
  });

  assert.equal(handle.surface.getHealth().lastPaintAt, null);
  assert.equal(handle.surface.getHealth().visible, true);

  handle.markPaint();
  const after = handle.surface.getHealth();
  assert.ok(after.lastPaintAt !== null && after.lastPaintAt > 0);

  mounted = false;
  assert.equal(handle.surface.getHealth().visible, false);

  handle.surface.setVisible(false);
  mounted = true;
  assert.equal(
    handle.surface.getHealth().visible,
    false,
    "even when mounted, an explicit setVisible(false) should hide the surface",
  );
});

test("pet surface forceRepaint swallows trigger errors so other surfaces still recover", () => {
  const handle = createPetSurface({
    triggerPaint: () => {
      throw new Error("simulated");
    },
    isMounted: () => true,
  });
  // Must not throw.
  handle.surface.forceRepaint("test", "light");
});

test("monaco surface forceRepaint calls render(true) and layout()", () => {
  let renderCalls = 0;
  let lastForceRedraw: boolean | undefined;
  let layoutCalls = 0;
  const editor: MonacoEditorLike = {
    render(force) {
      renderCalls += 1;
      lastForceRedraw = force;
    },
    layout() {
      layoutCalls += 1;
    },
  };
  const handle = createMonacoSurface({ editor, isMounted: () => true });

  handle.surface.forceRepaint("test", "heavy");
  assert.equal(renderCalls, 1);
  assert.equal(lastForceRedraw, true);
  assert.equal(layoutCalls, 1);
});

test("monaco surface getHealth.lastPaintAt is always recent (no stall detection)", () => {
  const handle = createMonacoSurface({
    editor: { render() {}, layout() {} },
    isMounted: () => true,
  });
  const before = Date.now();
  const health = handle.surface.getHealth();
  assert.ok((health.lastPaintAt ?? 0) >= before - 5);
  assert.equal(health.contextLost, false);
});

test("monaco surface forceRepaint isolates editor render errors", () => {
  const handle = createMonacoSurface({
    editor: {
      render() {
        throw new Error("editor in mid-disposal");
      },
      layout() {},
    },
    isMounted: () => true,
  });
  // Must not throw.
  handle.surface.forceRepaint("test", "light");
});

test("canvas surface forceRepaint re-writes the viewport", () => {
  let lastSet: { x: number; y: number; scale: number } | null = null;
  const handle = createCanvasSurface({
    getViewport: () => ({ x: 10, y: 20, scale: 1.5 }),
    setViewport: (v) => {
      lastSet = v;
    },
    isVisible: () => true,
  });

  handle.surface.forceRepaint("test", "heavy");
  assert.deepEqual(lastSet, { x: 10, y: 20, scale: 1.5 });
});

test("canvas surface forceRepaint is a no-op when getViewport returns null", () => {
  let setCalls = 0;
  const handle = createCanvasSurface({
    getViewport: () => null,
    setViewport: () => {
      setCalls += 1;
    },
    isVisible: () => true,
  });
  handle.surface.forceRepaint("test", "light");
  assert.equal(setCalls, 0);
});

test("canvas surface visible reflects the document visibility probe", () => {
  let visible = true;
  const handle = createCanvasSurface({
    getViewport: () => ({ x: 0, y: 0, scale: 1 }),
    setViewport: () => {},
    isVisible: () => visible,
  });

  assert.equal(handle.surface.getHealth().visible, true);
  visible = false;
  assert.equal(handle.surface.getHealth().visible, false);
});

test("each surface advertises a stable id + kind", () => {
  const pet = createPetSurface({
    triggerPaint: () => {},
    isMounted: () => true,
  });
  const monaco = createMonacoSurface({
    editor: { render() {}, layout() {} },
    isMounted: () => true,
  });
  const canvas = createCanvasSurface({
    getViewport: () => null,
    setViewport: () => {},
    isVisible: () => true,
  });

  assert.equal(pet.surface.id, "pet-overlay");
  assert.equal(pet.surface.kind, "pet");
  assert.equal(monaco.surface.id, "monaco-editor");
  assert.equal(monaco.surface.kind, "monaco");
  assert.equal(canvas.surface.id, "main-canvas");
  assert.equal(canvas.surface.kind, "canvas");
});
