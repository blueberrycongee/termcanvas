import test from "node:test";
import assert from "node:assert/strict";

import {
  createSafeUpdaterLogger,
  isBrokenPipeError,
  shouldScheduleAutoUpdateChecks,
} from "../electron/updater-helpers.ts";

test("isBrokenPipeError detects EPIPE by code", () => {
  assert.equal(isBrokenPipeError({ code: "EPIPE" }), true);
  assert.equal(isBrokenPipeError({ code: "ENOENT" }), false);
});

test("isBrokenPipeError detects broken pipe by message", () => {
  assert.equal(isBrokenPipeError(new Error("broken pipe")), true);
  assert.equal(isBrokenPipeError(new Error("something else")), false);
});

test("createSafeUpdaterLogger swallows broken pipe errors", () => {
  const logger = createSafeUpdaterLogger({
    info: () => {
      const error = new Error("broken pipe");
      Object.assign(error, { code: "EPIPE" });
      throw error;
    },
    warn: () => {},
    error: () => {},
  });

  assert.doesNotThrow(() => logger.info("Checking for update"));
});

test("createSafeUpdaterLogger preserves non-EPIPE failures", () => {
  const logger = createSafeUpdaterLogger({
    info: () => {
      throw new Error("permission denied");
    },
    warn: () => {},
    error: () => {},
  });

  assert.throws(() => logger.info("Checking for update"), /permission denied/);
});

test("shouldScheduleAutoUpdateChecks only enables packaged apps", () => {
  assert.equal(shouldScheduleAutoUpdateChecks(true), true);
  assert.equal(shouldScheduleAutoUpdateChecks(false), false);
});
