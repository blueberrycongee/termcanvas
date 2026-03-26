import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAheadBehindLabel,
  getVirtualCommitWindow,
} from "../src/components/LeftPanel/gitContentLayout.ts";

test("buildAheadBehindLabel formats branch divergence compactly", () => {
  assert.equal(buildAheadBehindLabel(0, 0), null);
  assert.equal(buildAheadBehindLabel(3, 0), "↑3");
  assert.equal(buildAheadBehindLabel(0, 2), "↓2");
  assert.equal(buildAheadBehindLabel(4, 1), "↑4 ↓1");
});

test("getVirtualCommitWindow clamps the visible window with overscan", () => {
  assert.deepEqual(
    getVirtualCommitWindow({
      itemCount: 120,
      overscan: 6,
      rowHeight: 44,
      scrollTop: 0,
      viewportHeight: 220,
    }),
    { startIndex: 0, endIndex: 11 },
  );

  assert.deepEqual(
    getVirtualCommitWindow({
      itemCount: 120,
      overscan: 6,
      rowHeight: 44,
      scrollTop: 44 * 20,
      viewportHeight: 220,
    }),
    { startIndex: 14, endIndex: 31 },
  );

  assert.deepEqual(
    getVirtualCommitWindow({
      itemCount: 24,
      overscan: 6,
      rowHeight: 44,
      scrollTop: 44 * 22,
      viewportHeight: 220,
    }),
    { startIndex: 16, endIndex: 24 },
  );
});
