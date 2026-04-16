import test from "node:test";
import assert from "node:assert/strict";

import { PET_HALF_SIZE, PET_SIZE } from "../src/pet/constants.ts";
import { getTerminalTitleBarTarget, stepToward } from "../src/pet/petMovement.ts";

test("getTerminalTitleBarTarget centers the pet using the current sprite size", () => {
  const target = getTerminalTitleBarTarget({
    x: 100,
    y: 240,
    width: 300,
  });

  assert.equal(target.x, 100 + 300 / 2 - PET_HALF_SIZE);
  assert.equal(target.y, 240);
  assert.equal(target.onTitleBar, true);
});

test("getTerminalTitleBarTarget keeps edge placement aligned to the current pet size", () => {
  const target = getTerminalTitleBarTarget(
    {
      x: 100,
      y: 240,
      width: 300,
    },
    true,
  );

  assert.equal(target.x, 100 + 300 - PET_SIZE - 8);
  assert.equal(target.y, 240);
  assert.equal(target.onTitleBar, true);
});

test("stepToward lands on top of the title bar using the current pet height", () => {
  const result = stepToward(
    { x: 200, y: 110 },
    { x: 200, y: 240, onTitleBar: true },
  );

  assert.equal(result.arrived, true);
  assert.deepEqual(result.position, {
    x: 200,
    y: 240 - 34 - PET_SIZE,
  });
});
