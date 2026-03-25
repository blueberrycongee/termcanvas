import test from "node:test";
import assert from "node:assert/strict";

import {
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

test("canvas viewport frame centers content at window center (main semantics)", () => {
  withWindowSize(1440, 900, () => {
    const frame = getCanvasViewportFrame({ rightPanelCollapsed: true });

    assert.equal(frame.centerX, (1440 - 32) / 2);
    assert.equal(frame.centerY, 900 / 2);
  });
});

test("centered viewport targets use window centerY (main semantics)", () => {
  withWindowSize(1440, 900, () => {
    const target = getCenteredViewportTarget(100, 200, 640, 480, {
      rightPanelCollapsed: true,
      scale: 1,
    });

    assert.equal(target.x, -(100 + 320) + (1440 - 32) / 2);
    assert.equal(target.y, -(200 + 240) + 900 / 2);
  });
});

test("fit scale uses full window height (main semantics)", () => {
  withWindowSize(1440, 900, () => {
    const scale = getViewportFitScale(640, 480, {
      rightPanelCollapsed: true,
      padding: 60,
    });

    assert.equal(
      scale,
      Math.min((1440 - 32 - 120) / 640, (900 - 120) / 480),
    );
  });
});
