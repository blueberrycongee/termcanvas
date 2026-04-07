import test from "node:test";
import assert from "node:assert/strict";
import { computeBackoff, withRetry } from "../shared/backoff.ts";

test("computeBackoff returns baseMs for attempt 1", () => {
  // With jitterFraction=0, should return exact baseMs
  const delay = computeBackoff(1, { baseMs: 500, jitterFraction: 0 });
  assert.equal(delay, 500);
});

test("computeBackoff doubles on attempt 2", () => {
  const delay = computeBackoff(2, { baseMs: 500, multiplier: 2, jitterFraction: 0 });
  assert.equal(delay, 1000);
});

test("computeBackoff caps at maxMs", () => {
  const delay = computeBackoff(10, { baseMs: 500, maxMs: 2000, multiplier: 2, jitterFraction: 0 });
  assert.equal(delay, 2000);
});

test("computeBackoff applies jitter within range", () => {
  const baseMs = 1000;
  const jitterFraction = 0.25;
  // Run 100 times and verify all delays are within expected range
  for (let i = 0; i < 100; i++) {
    const delay = computeBackoff(1, { baseMs, jitterFraction, multiplier: 2 });
    const minExpected = baseMs * (1 - jitterFraction);
    const maxExpected = baseMs * (1 + jitterFraction);
    assert.ok(
      delay >= minExpected && delay <= maxExpected,
      `Delay ${delay} out of range [${minExpected}, ${maxExpected}]`,
    );
  }
});

test("computeBackoff minimum is 50ms", () => {
  const delay = computeBackoff(1, { baseMs: 1, jitterFraction: 0, multiplier: 1 });
  assert.equal(delay, 50);
});

test("withRetry returns result on first success", async () => {
  const result = await withRetry(() => Promise.resolve(42));
  assert.equal(result, 42);
});

test("withRetry retries on failure and eventually succeeds", async () => {
  let attempts = 0;
  const result = await withRetry(
    () => {
      attempts++;
      if (attempts < 3) throw new Error("not yet");
      return Promise.resolve("success");
    },
    { maxAttempts: 5, backoff: { baseMs: 10, jitterFraction: 0 } },
  );
  assert.equal(result, "success");
  assert.equal(attempts, 3);
});

test("withRetry throws after max attempts exhausted", async () => {
  let attempts = 0;
  try {
    await withRetry(
      () => {
        attempts++;
        throw new Error("always fail");
      },
      { maxAttempts: 3, backoff: { baseMs: 10, jitterFraction: 0 } },
    );
    assert.fail("should have thrown");
  } catch (err: any) {
    assert.equal(err.message, "always fail");
    assert.equal(attempts, 3);
  }
});
