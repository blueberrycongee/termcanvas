export const HEATMAP_LAYOUT = {
  cellSize: 12,
  gridGap: 3,
  monthLabelLineHeight: 10,
  // Sit the month label row directly on top of the cells (same
  // height as the line itself → no padding below). Previously it
  // was 16 with a 12px line, which left a 4px gap that made the
  // labels look detached from the grid.
  monthLabelRowHeight: 10,
  weekdayLabelWidth: 14,
} as const;

export function hasMonthLabelBottomClearance(layout = HEATMAP_LAYOUT): boolean {
  return layout.monthLabelRowHeight - layout.monthLabelLineHeight >= layout.gridGap;
}
