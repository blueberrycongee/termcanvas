import test from "node:test";
import assert from "node:assert/strict";

import {
  CANVAS_TOP_INSET,
  getCanvasViewportFrame,
  getCenteredViewportTarget,
  getViewportFitScale,
} from "../src/utils/canvasViewport.ts";

function withWindowSize(
  width: number,
  height: number,
  run: () => void,
) {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    innerWidth: width,
    innerHeight: height,
  };

  try {
    run();
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
}

test("canvas viewport frame centers content below the toolbar inset", () => {
  withWindowSize(1440, 900, () => {
    const frame = getCanvasViewportFrame({ rightPanelCollapsed: true });

    assert.equal(frame.centerX, (1440 - 32) / 2);
    assert.equal(frame.centerY, CANVAS_TOP_INSET + (900 - CANVAS_TOP_INSET) / 2);
  });
});

test("centered viewport targets honor the toolbar-adjusted visual center", () => {
  withWindowSize(1440, 900, () => {
    const target = getCenteredViewportTarget(100, 200, 640, 480, {
      rightPanelCollapsed: true,
      scale: 1,
    });

    assert.equal(target.x, -(100 + 320) + (1440 - 32) / 2);
    assert.equal(
      target.y,
      -(200 + 240) + CANVAS_TOP_INSET + (900 - CANVAS_TOP_INSET) / 2,
    );
  });
});

test("fit scale uses the toolbar-adjusted viewport height", () => {
  withWindowSize(1440, 900, () => {
    const scale = getViewportFitScale(640, 480, {
      rightPanelCollapsed: true,
      padding: 60,
    });

    assert.equal(
      scale,
      Math.min((1440 - 32 - 120) / 640, (900 - CANVAS_TOP_INSET - 120) / 480),
    );
  });
});
