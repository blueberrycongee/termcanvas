export const HEATMAP_LAYOUT = {
  cellSize: 12,
  gridGap: 3,
  weekdayColumnGap: 3,
  weekdayColumnMarginRight: 2,
  monthLabelLineHeight: 10,
  // Sit the month label row directly on top of the cells (same
  // height as the line itself → no padding below). Previously it
  // was 16 with a 12px line, which left a 4px gap that made the
  // labels look detached from the grid.
  monthLabelRowHeight: 10,
  weekdayLabelWidth: 14,
} as const;

export function hasTightMonthLabelRow(layout = HEATMAP_LAYOUT): boolean {
  return layout.monthLabelRowHeight === layout.monthLabelLineHeight;
}

export function heatmapNaturalWidth(
  weeks: number,
  layout = HEATMAP_LAYOUT,
): number {
  if (weeks <= 0) return 0;
  return (
    layout.weekdayLabelWidth +
    layout.weekdayColumnMarginRight +
    layout.weekdayColumnGap +
    weeks * layout.cellSize +
    (weeks - 1) * layout.gridGap
  );
}

export function maxHeatmapWeeksForDaySpan(days: number): number {
  return Math.ceil((days + 6) / 7);
}
