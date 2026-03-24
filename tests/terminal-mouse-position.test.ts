import test from "node:test";
import assert from "node:assert/strict";

import { getCorrectedTerminalMousePosition } from "../src/terminal/mousePosition.ts";

test("mouse correction converts scaled terminal coordinates back to local space", () => {
  const corrected = getCorrectedTerminalMousePosition(
    { clientX: 360, clientY: 330 },
    { left: 100, top: 200 },
    1.3,
  );

  assert.equal(corrected.clientX, 300);
  assert.equal(corrected.clientY, 300);
  assert.equal(corrected.offsetX, 200);
  assert.equal(corrected.offsetY, 100);
});
