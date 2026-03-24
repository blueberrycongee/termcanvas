import test from "node:test";
import assert from "node:assert/strict";

import { getCloseAction } from "../src/closeFlow.ts";

test("dirty normal close still prompts for save confirmation", () => {
  assert.equal(
    getCloseAction({ dirty: true, installUpdateRequested: false }),
    "prompt-save",
  );
});

test("restarting to install an update bypasses the save confirmation dialog", () => {
  assert.equal(
    getCloseAction({ dirty: true, installUpdateRequested: true }),
    "silent-close",
  );
});

test("clean close stays silent regardless of update state", () => {
  assert.equal(
    getCloseAction({ dirty: false, installUpdateRequested: false }),
    "silent-close",
  );
  assert.equal(
    getCloseAction({ dirty: false, installUpdateRequested: true }),
    "silent-close",
  );
});
