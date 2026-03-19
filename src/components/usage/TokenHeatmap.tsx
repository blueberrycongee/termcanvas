import { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useUsageStore, type HeatmapEntry } from "../../stores/usageStore";
import { useT } from "../../i18n/useT";

// ── Helpers ──────────────────────────────────────────────────────────

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

const HEATMAP_DAYS = 91;
const COLOR_LEVELS = [
  "var(--border)",        // level 0: no data
  "rgba(0,112,243,0.2)",  // level 1
  "rgba(0,112,243,0.4)",  // level 2
  "rgba(0,112,243,0.65)", // level 3
  "rgba(0,112,243,0.9)",  // level 4
];

interface CellData {
  dateStr: string;
  entry: HeatmapEntry | undefined;
  level: number;
  index: number;
}

function buildGrid(data: Record<string, HeatmapEntry>): { cells: (CellData | null)[][]; weeks: number } {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (HEATMAP_DAYS - 1));

  // Align start to Sunday
  const startDay = startDate.getDay();
  if (startDay !== 0) {
    startDate.setDate(startDate.getDate() - startDay);
  }

  const totalDays = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const weeks = Math.ceil(totalDays / 7);

  // Compute max tokens for level scaling
  const values = Object.values(data).map((e) => e.tokens).filter((t) => t > 0);
  const maxTokens = values.length > 0 ? Math.max(...values) : 1;

  // Build 7 rows × N columns grid
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

      // Skip future dates
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

  return { cells: grid, weeks };
}

// ── Tooltip ──────────────────────────────────────────────────────────

interface TooltipProps {
  cell: CellData;
  triggerRect: DOMRect;
}

function HeatmapTooltip({ cell, triggerRect }: TooltipProps) {
  const t = useT();
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const flipUp = spaceBelow < 60;

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none usage-tooltip-enter"
      style={{
        top: flipUp ? undefined : triggerRect.bottom + 4,
        bottom: flipUp ? window.innerHeight - triggerRect.top + 4 : undefined,
        left: triggerRect.left + triggerRect.width / 2,
        transform: "translateX(-50%)",
      }}
    >
      <div
        className="rounded-md px-2 py-1.5 border border-[var(--border)] bg-[var(--surface)] shadow-lg whitespace-nowrap"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        <div className="text-[10px] text-[var(--text-secondary)] font-medium">{cell.dateStr}</div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px]">
          <span className="text-[var(--text-primary)]">{fmtTokens(cell.entry?.tokens ?? 0)} {t.usage_tokens_label}</span>
          <span className="text-[var(--text-faint)]">·</span>
          <span className="text-[var(--text-muted)]">{fmtCost(cell.entry?.cost ?? 0)}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main component ───────────────────────────────────────────────────

interface TokenHeatmapProps {
  animate: boolean;
}

export function TokenHeatmap({ animate }: TokenHeatmapProps): React.ReactElement {
  const t = useT();
  const { heatmapData, heatmapLoading, heatmapError, fetchHeatmap, fetch: fetchDay } = useUsageStore();
  const [hoveredCell, setHoveredCell] = useState<CellData | null>(null);
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    fetchHeatmap();
  }, [fetchHeatmap]);

  const { cells, weeks } = useMemo(() => buildGrid(heatmapData), [heatmapData]);

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

  if (heatmapLoading) {
    return (
      <div className="px-3 py-2.5">
        <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
          {t.usage_heatmap}
        </span>
        <div className="mt-2 text-[10px] text-[var(--text-faint)]">{t.usage_heatmap_loading}</div>
      </div>
    );
  }

  if (heatmapError) {
    return (
      <div className="px-3 py-2.5">
        <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
          {t.usage_heatmap}
        </span>
        <div className="mt-2 text-[10px] text-[var(--red)]">{t.usage_heatmap_error}</div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_heatmap}
      </span>

      <div className="mt-2 flex gap-[3px]">
        {/* Weekday labels */}
        <div className="flex flex-col gap-[3px] shrink-0 mr-0.5">
          {Array.from({ length: 7 }, (_, row) => (
            <div
              key={row}
              className="flex items-center justify-end text-[8px] text-[var(--text-faint)]"
              style={{
                width: 14,
                height: 10,
                fontFamily: '"Geist Mono", monospace',
              }}
            >
              {LABEL_ROWS.includes(row) ? WEEKDAY_LABELS[row] : ""}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div
          className="flex-1 min-w-0 grid gap-[3px]"
          style={{
            gridTemplateColumns: `repeat(${weeks}, 1fr)`,
            gridTemplateRows: "repeat(7, 10px)",
          }}
        >
          {/* Render column by column (week by week) */}
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
                  className={`rounded-[2px] transition-[filter] duration-100 ${animate ? "heatmap-cell-enter" : ""}`}
                  style={{
                    backgroundColor: COLOR_LEVELS[cell.level],
                    animationDelay: animate ? `${cell.index * 8}ms` : undefined,
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
      </div>

      {/* Color legend */}
      <div className="flex items-center justify-end gap-1 mt-1.5">
        <span
          className="text-[8px] text-[var(--text-faint)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {t.usage_heatmap_less}
        </span>
        {COLOR_LEVELS.map((color, i) => (
          <div
            key={i}
            className="rounded-[2px]"
            style={{ width: 8, height: 8, backgroundColor: color }}
          />
        ))}
        <span
          className="text-[8px] text-[var(--text-faint)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {t.usage_heatmap_more}
        </span>
      </div>

      {/* Tooltip */}
      {hoveredCell && hoveredRect && <HeatmapTooltip cell={hoveredCell} triggerRect={hoveredRect} />}
    </div>
  );
}
