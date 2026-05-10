import test from "node:test";
import assert from "node:assert/strict";

import {
  __recordWebGLContextLossForTesting,
  __resetWebGLDemotionForTesting,
  clearWebGLDemotion,
  isWebGLDemoted,
} from "../src/terminal/webglContextPool.ts";

// The demotion thresholds are constants in the implementation:
// 3 losses within 60 s. Tests assume those values.
test("a single context loss does not demote", () => {
  __resetWebGLDemotionForTesting();
  const tipped = __recordWebGLContextLossForTesting("term-a");
  assert.equal(tipped, false);
  assert.equal(isWebGLDemoted("term-a"), false);
});

test("three context losses within the window demote", () => {
  __resetWebGLDemotionForTesting();
  __recordWebGLContextLossForTesting("term-a");
  __recordWebGLContextLossForTesting("term-a");
  const tipped = __recordWebGLContextLossForTesting("term-a");
  assert.equal(tipped, true);
  assert.equal(isWebGLDemoted("term-a"), true);
});

test("subsequent losses on a demoted terminal don't double-fire 'tipped'", () => {
  __resetWebGLDemotionForTesting();
  __recordWebGLContextLossForTesting("term-a");
  __recordWebGLContextLossForTesting("term-a");
  __recordWebGLContextLossForTesting("term-a"); // tipped
  const second = __recordWebGLContextLossForTesting("term-a");
  assert.equal(second, false);
  assert.equal(isWebGLDemoted("term-a"), true);
});

test("demotion is per-terminal — one terminal's losses don't demote others", () => {
  __resetWebGLDemotionForTesting();
  __recordWebGLContextLossForTesting("term-a");
  __recordWebGLContextLossForTesting("term-a");
  __recordWebGLContextLossForTesting("term-a"); // a is demoted

  assert.equal(isWebGLDemoted("term-a"), true);
  assert.equal(isWebGLDemoted("term-b"), false);

  __recordWebGLContextLossForTesting("term-b");
  assert.equal(isWebGLDemoted("term-b"), false);
});

test("clearWebGLDemotion resets a demoted terminal", () => {
  __resetWebGLDemotionForTesting();
  __recordWebGLContextLossForTesting("term-a");
  __recordWebGLContextLossForTesting("term-a");
  __recordWebGLContextLossForTesting("term-a");
  assert.equal(isWebGLDemoted("term-a"), true);

  clearWebGLDemotion("term-a");
  assert.equal(isWebGLDemoted("term-a"), false);

  // After clearing, the loss counter is also reset — three new losses
  // are required to re-demote.
  __recordWebGLContextLossForTesting("term-a");
  __recordWebGLContextLossForTesting("term-a");
  assert.equal(isWebGLDemoted("term-a"), false);
  __recordWebGLContextLossForTesting("term-a");
  assert.equal(isWebGLDemoted("term-a"), true);
});
