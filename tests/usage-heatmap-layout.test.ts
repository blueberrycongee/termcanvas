import test from "node:test";
import assert from "node:assert/strict";

import {
  HEATMAP_LAYOUT,
  hasTightMonthLabelRow,
} from "../src/components/usage/heatmap-layout.ts";

test("heatmap month label row stays tight to the grid", () => {
  assert.equal(hasTightMonthLabelRow(), true);
  assert.equal(HEATMAP_LAYOUT.monthLabelRowHeight, HEATMAP_LAYOUT.monthLabelLineHeight);
});
