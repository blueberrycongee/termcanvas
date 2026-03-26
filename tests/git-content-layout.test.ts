import test from "node:test";
import assert from "node:assert/strict";

import { summarizeCommitRefs } from "../src/components/LeftPanel/gitContentLayout.ts";

test("summarizeCommitRefs keeps only the highest-priority refs visible in narrow rows", () => {
  const summary = summarizeCommitRefs([
    "origin/main",
    "tag: v1.2.3",
    "HEAD -> main",
    "feature/extra",
  ]);

  assert.deepEqual(summary.visibleRefs, ["HEAD -> main", "tag: v1.2.3"]);
  assert.equal(summary.hiddenCount, 2);
});

test("summarizeCommitRefs preserves all refs when the list is already short", () => {
  const summary = summarizeCommitRefs(["HEAD -> main", "origin/main"]);

  assert.deepEqual(summary.visibleRefs, ["HEAD -> main", "origin/main"]);
  assert.equal(summary.hiddenCount, 0);
});
