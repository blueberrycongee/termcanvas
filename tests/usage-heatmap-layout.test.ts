import test from "node:test";
import assert from "node:assert/strict";

import {
  HEATMAP_LAYOUT,
  heatmapNaturalWidth,
  hasTightMonthLabelRow,
  maxHeatmapWeeksForDaySpan,
} from "../src/components/usage/heatmap-layout.ts";

test("heatmap month label row stays tight to the grid", () => {
  assert.equal(hasTightMonthLabelRow(), true);
  assert.equal(HEATMAP_LAYOUT.monthLabelRowHeight, HEATMAP_LAYOUT.monthLabelLineHeight);
});

test("heatmap width estimate includes labels and inter-column spacing", () => {
  assert.equal(maxHeatmapWeeksForDaySpan(91), 14);
  assert.equal(maxHeatmapWeeksForDaySpan(182), 27);
  assert.equal(maxHeatmapWeeksForDaySpan(364), 53);
  assert.equal(
    heatmapNaturalWidth(53),
    HEATMAP_LAYOUT.weekdayLabelWidth +
      HEATMAP_LAYOUT.weekdayColumnMarginRight +
      HEATMAP_LAYOUT.weekdayColumnGap +
      53 * HEATMAP_LAYOUT.cellSize +
      52 * HEATMAP_LAYOUT.gridGap,
  );
});
