import { useEffect, useState, useRef, useMemo, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useUsageStore, type HeatmapEntry } from "../../stores/usageStore";
import { useT } from "../../i18n/useT";
import {
  HEATMAP_LAYOUT,
  heatmapNaturalWidth,
  maxHeatmapWeeksForDaySpan,
} from "./heatmap-layout";

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtCost(c: number): string {
  return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(3)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const HEATMAP_DAYS = 91; // ≈13 weeks, sidebar / narrow overlay
const HEATMAP_DAYS_MEDIUM = 182; // ≈26 weeks, mid-width overlay
const HEATMAP_DAYS_LARGE = 364; // ≈52 weeks, wide overlay

const COLOR_LEVELS = [
  "var(--border)", // level 0: no data
  "var(--usage-heatmap-1)", // level 1
  "var(--usage-heatmap-2)", // level 2
  "var(--usage-heatmap-3)", // level 3
  "var(--usage-heatmap-4)", // level 4
];

interface CellData {
  dateStr: string;
  entry: HeatmapEntry | undefined;
  level: number;
  index: number;
}

interface MonthLabel {
  month: number;
  column: number;
}

function buildGrid(
  data: Record<string, HeatmapEntry>,
  totalDaysSpan: number = HEATMAP_DAYS,
): {
  cells: (CellData | null)[][];
  weeks: number;
  monthLabels: MonthLabel[];
} {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (totalDaysSpan - 1));

  // Heatmap columns are weeks; align to Sunday so each column is a full Sun–Sat week
  const startDay = startDate.getDay();
  if (startDay !== 0) {
    startDate.setDate(startDate.getDate() - startDay);
  }

  const totalDays =
    Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) +
    1;
  const weeks = Math.ceil(totalDays / 7);

  const values = Object.values(data)
    .map((e) => e.tokens)
    .filter((t) => t > 0);
  const maxTokens = values.length > 0 ? Math.max(...values) : 1;

  const grid: (CellData | null)[][] = Array.from({ length: 7 }, () =>
    Array.from<null>({ length: weeks }).fill(null),
  );

  let cellIndex = 0;
  const todayStr = toDateStr(today);

  for (let week = 0; week < weeks; week++) {
    for (let day = 0; day < 7; day++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + week * 7 + day);
      const dateStr = toDateStr(d);

      if (dateStr > todayStr) continue;

      const entry = data[dateStr];
      const tokens = entry?.tokens ?? 0;
      let level = 0;
      if (tokens > 0) {
        const ratio = tokens / maxTokens;
        if (ratio <= 0.25) level = 1;
        else if (ratio <= 0.5) level = 2;
        else if (ratio <= 0.75) level = 3;
        else level = 4;
      }

      grid[day][week] = {
        dateStr,
        entry,
        level,
        index: cellIndex++,
      };
    }
  }

  const rawLabels: MonthLabel[] = [];
  let lastMonth = -1;
  for (let week = 0; week < weeks; week++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + week * 7);
    const month = d.getMonth();
    if (month !== lastMonth) {
      rawLabels.push({ month, column: week });
      lastMonth = month;
    }
  }
  // Filter: only show labels with enough room (≥2 columns before next label)
  const monthLabels = rawLabels.filter((label, i) => {
    const next = rawLabels[i + 1];
    if (!next) return true;
    return next.column - label.column >= 2;
  });

  return { cells: grid, weeks, monthLabels };
}

function formatHeatmapDate(
  dateStr: string,
  monthsShort: readonly string[],
): string {
  const [, m, d] = dateStr.split("-");
  return `${monthsShort[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

interface TooltipProps {
  cell: CellData;
  triggerRect: DOMRect;
}

function HeatmapTooltip({ cell, triggerRect }: TooltipProps) {
  const t = useT();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const flipUp = spaceBelow < 60;

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    if (rect.right > window.innerWidth - margin) {
      el.style.left = `${parseFloat(el.style.left) - (rect.right - (window.innerWidth - margin))}px`;
    } else if (rect.left < margin) {
      el.style.left = `${parseFloat(el.style.left) + (margin - rect.left)}px`;
    }
  });

  const dateLabel = formatHeatmapDate(cell.dateStr, t.usage_cal_months_short);

  return createPortal(
    <div
      ref={tooltipRef}
      className="fixed z-[9999] pointer-events-none usage-tooltip-enter"
      style={{
        top: flipUp ? undefined : triggerRect.bottom + 4,
        bottom: flipUp ? window.innerHeight - triggerRect.top + 4 : undefined,
        left: triggerRect.left + triggerRect.width / 2,
        transform: "translateX(-50%)",
      }}
    >
      <div className="rounded-md px-2.5 py-1.5 border border-[var(--border)] bg-[var(--surface)] shadow-lg whitespace-nowrap tc-mono tc-num">
        <div className="text-[10px] text-[var(--text-secondary)] font-medium">
          {dateLabel}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px]">
          <span className="text-[var(--text-primary)]">
            {fmtTokens(cell.entry?.tokens ?? 0)} {t.usage_tokens_label}
          </span>
          <span className="text-[var(--text-faint)]">·</span>
          <span className="text-[var(--text-muted)]">
            {fmtCost(cell.entry?.cost ?? 0)}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface TokenHeatmapProps {
  animate: boolean;
  /** When provided, overrides the store's local-only heatmapData (e.g. merged local+cloud). */
  data?: Record<string, HeatmapEntry>;
  onVisible?: () => void;
  /**
   * Skip the component's own outer padding + title span. Used by the
   * full-screen overlay where SectionCard already renders both.
   */
  bare?: boolean;
  /**
   * `"default"` (≈13 weeks, for the narrow sidebar), `"large"`
   * (≈52 weeks, for a wide overlay), or `"auto"` to pick the
   * longest span that actually fits the card's inline size. Auto is
   * the right choice for container-query layouts where the heatmap
   * card's width is driven by the enclosing grid rather than a
   * prop. The fit check uses the component's content box, not the
   * padded outer box, so the selected ribbon does not get clipped by
   * the surrounding card.
   */
  size?: "default" | "large" | "auto";
}

export function TokenHeatmap({
  animate,
  data,
  onVisible,
  bare = false,
  size = "default",
}: TokenHeatmapProps): React.ReactElement {
  const t = useT();
  const {
    heatmapData,
    heatmapLoading,
    heatmapError,
    fetch: fetchDay,
  } = useUsageStore();
  const [hoveredCell, setHoveredCell] = useState<CellData | null>(null);
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const requestedRef = useRef(false);

  const [measuredContentWidth, setMeasuredContentWidth] = useState<
    number | null
  >(null);

  useEffect(() => {
    if (!containerRef.current || requestedRef.current) return;

    const triggerLoad = () => {
      if (requestedRef.current) return;
      requestedRef.current = true;
      onVisible?.();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          triggerLoad();
          observer.disconnect();
        }
      },
      { rootMargin: "120px 0px" },
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [onVisible]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measureContentWidth = () => {
      const style = window.getComputedStyle(el);
      const padding =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setMeasuredContentWidth(
        Math.max(0, el.getBoundingClientRect().width - padding),
      );
    };
    measureContentWidth();
    const ro = new ResizeObserver((entries) => {
      if (entries.length > 0) measureContentWidth();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveData = data ?? heatmapData;
  const daysSpan = useMemo(() => {
    if (size === "large") return HEATMAP_DAYS_LARGE;
    if (size === "default") return HEATMAP_DAYS;
    const w = measuredContentWidth;
    if (w === null) return HEATMAP_DAYS;
    if (
      w >=
      heatmapNaturalWidth(maxHeatmapWeeksForDaySpan(HEATMAP_DAYS_LARGE))
    ) {
      return HEATMAP_DAYS_LARGE;
    }
    if (
      w >=
      heatmapNaturalWidth(maxHeatmapWeeksForDaySpan(HEATMAP_DAYS_MEDIUM))
    ) {
      return HEATMAP_DAYS_MEDIUM;
    }
    return HEATMAP_DAYS;
  }, [size, measuredContentWidth]);
  const { cells, weeks, monthLabels } = useMemo(
    () => buildGrid(effectiveData, daysSpan),
    [effectiveData, daysSpan],
  );
  const naturalWidth = heatmapNaturalWidth(weeks);
  const canCenter =
    !bare ||
    measuredContentWidth === null ||
    naturalWidth <= measuredContentWidth;

  const handleCellClick = (cell: CellData) => {
    fetchDay(cell.dateStr);
  };

  const handleCellHover = (cell: CellData | null, dateStr?: string) => {
    if (cell && dateStr) {
      const el = cellRefs.current.get(dateStr);
      if (el) {
        setHoveredRect(el.getBoundingClientRect());
      }
    }
    setHoveredCell(cell);
  };

  const WEEKDAY_LABELS = t.usage_cal_weekdays;
  const LABEL_ROWS = [1, 3, 5]; // Mon, Wed, Fri

  const outerClass = bare ? "px-4 py-3" : "px-3 py-2.5";

  if (heatmapLoading) {
    return (
      <div className={outerClass}>
        {!bare && <span className="tc-eyebrow">{t.usage_heatmap}</span>}
        <div className={`${bare ? "" : "mt-2"} tc-caption`}>
          {t.usage_heatmap_loading}
        </div>
      </div>
    );
  }

  if (heatmapError) {
    return (
      <div className={outerClass}>
        {!bare && <span className="tc-eyebrow">{t.usage_heatmap}</span>}
        <div
          className={`${bare ? "" : "mt-2"} text-[10px]`}
          style={{ color: "var(--red)" }}
        >
          {t.usage_heatmap_error}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={outerClass}>
      {!bare && <span className="tc-eyebrow">{t.usage_heatmap}</span>}

      {/*
        Centered wrapper so a ribbon narrower than the card doesn't
        hug the left edge with an ocean of empty space to the right.
        In bare (overlay) mode the grid + legend both sit in an
        inline-block that's centered inside the card — the legend
        aligns with the grid's right edge, not the card's.
      */}
      <div className={bare ? "overflow-x-auto" : undefined}>
        <div
          className={bare ? "w-fit" : undefined}
          style={bare && canCenter ? { marginInline: "auto" } : undefined}
        >
          <div className={`${bare ? "" : "mt-2 "}flex gap-[3px]`}>
            <div className="flex flex-col gap-[3px] shrink-0 mr-0.5">
              {Array.from({ length: 7 }, (_, row) => (
                <div
                  key={row}
                  className="flex items-center justify-end text-[8px] text-[var(--text-faint)] tc-mono"
                  style={{
                    width: HEATMAP_LAYOUT.weekdayLabelWidth,
                    height: HEATMAP_LAYOUT.cellSize,
                  }}
                >
                  {LABEL_ROWS.includes(row) ? WEEKDAY_LABELS[row] : ""}
                </div>
              ))}
              {/* Spacer to align the weekday column with the month
              labels below the grid. */}
              <div style={{ height: HEATMAP_LAYOUT.monthLabelRowHeight }} />
            </div>

            <div className="flex flex-col gap-[3px]">
              {/*
            Fixed column width (cellSize px) instead of 1fr. The
            parent row used to be flex-1 which stretched each cell
            to ~80 px on a 1100 px overlay — nothing about a
            heatmap benefits from 80 px squares, it just looked
            broken. Natural width packs the ribbon tight.
          */}
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${weeks}, ${HEATMAP_LAYOUT.cellSize}px)`,
                  gridTemplateRows: `repeat(7, ${HEATMAP_LAYOUT.cellSize}px)`,
                  gap: HEATMAP_LAYOUT.gridGap,
                }}
              >
                {Array.from({ length: weeks }, (_, week) =>
                  Array.from({ length: 7 }, (_, day) => {
                    const cell = cells[day][week];
                    if (!cell) {
                      return <div key={`${week}-${day}`} />;
                    }

                    return (
                      <button
                        key={cell.dateStr}
                        ref={(el) => {
                          if (el) cellRefs.current.set(cell.dateStr, el);
                        }}
                        className={`rounded-[2px] transition-[filter] duration-quick ${animate ? "heatmap-cell-enter" : ""}`}
                        style={{
                          backgroundColor: COLOR_LEVELS[cell.level],
                          animationDelay: animate
                            ? `${cell.index * 8}ms`
                            : undefined,
                          gridColumn: week + 1,
                          gridRow: day + 1,
                        }}
                        onClick={() => handleCellClick(cell)}
                        onMouseEnter={() => handleCellHover(cell, cell.dateStr)}
                        onMouseLeave={() => handleCellHover(null)}
                      />
                    );
                  }),
                )}
              </div>

              {/*
            Month labels moved BELOW the grid so the heatmap's time
            axis lands at the same spot every other chart puts its
            time axis (under the data). Previously the labels sat
            on top, which made them read as a title rather than an
            axis and misaligned with MonthlyTrendChart's bottom
            labels in the overlay. alignItems: start pins the text
            right under the last cell row instead of centring it in
            the row height.
          */}
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${weeks}, ${HEATMAP_LAYOUT.cellSize}px)`,
                  height: HEATMAP_LAYOUT.monthLabelRowHeight,
                  gap: HEATMAP_LAYOUT.gridGap,
                  alignItems: "start",
                }}
              >
                {monthLabels.map((m) => (
                  <span
                    key={`month-${m.column}`}
                    className="text-[8px] text-[var(--text-faint)] tc-mono"
                    style={{
                      gridColumn: m.column + 1,
                      gridRow: 1,
                      lineHeight: `${HEATMAP_LAYOUT.monthLabelLineHeight}px`,
                    }}
                  >
                    {t.usage_cal_months_short[m.month]}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-1 mt-2">
            <span className="text-[8px] text-[var(--text-faint)] tc-mono">
              {t.usage_heatmap_less}
            </span>
            {COLOR_LEVELS.map((color, i) => (
              <div
                key={`legend-${i}`}
                className="rounded-[2px]"
                style={{ width: 8, height: 8, backgroundColor: color }}
              />
            ))}
            <span className="text-[8px] text-[var(--text-faint)] tc-mono">
              {t.usage_heatmap_more}
            </span>
          </div>
        </div>
      </div>

      {hoveredCell && hoveredRect && (
        <HeatmapTooltip cell={hoveredCell} triggerRect={hoveredRect} />
      )}
    </div>
  );
}
