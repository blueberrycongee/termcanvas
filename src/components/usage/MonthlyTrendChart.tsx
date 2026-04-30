import { useMemo, useState } from "react";
import type { HeatmapEntry } from "../../stores/usageStore";

/*
 * Daily-cost bar chart for the past N days.
 *
 * Sits in the Usage overlay alongside the existing hourly sparkline.
 * The hourly view answers "when within today?" — this one answers
 * "am I spending more or less than last week?" which the hourly
 * chart can't show on its own.
 *
 * Data source is the same `activeHeatmap` dictionary the calendar
 * heatmap uses (keyed by "YYYY-MM-DD" → { cost, tokens }), so no new
 * backend wiring. We just slice the last N days relative to the
 * viewing date.
 */

function fmtCost(c: number): string {
  if (c === 0) return "$0";
  return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(3)}`;
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

interface Props {
  heatmap: Record<string, HeatmapEntry> | null;
  /**
   * The date the user is "viewing" — usually today. The chart shows
   * the (days) preceding range ending on this date inclusive so
   * navigating to a past date reframes the comparison window.
   */
  focusDate: string;
  /** Number of days to render. Default 30. */
  days?: number;
  animate?: boolean;
  /** Height of the bar area in pixels. See SparklineChart for rationale. */
  heightPx?: number;
}

export function MonthlyTrendChart({
  heatmap,
  focusDate,
  days = 30,
  animate = true,
  heightPx = 64,
}: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  const bars = useMemo(() => {
    const end = parseDateKey(focusDate);
    const result: { date: string; cost: number; isFuture: boolean }[] = [];
    const todayKey = toDateKey(new Date());
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const key = toDateKey(d);
      const entry = heatmap?.[key];
      result.push({
        date: key,
        cost: entry?.cost ?? 0,
        isFuture: key > todayKey,
      });
    }
    return result;
  }, [heatmap, focusDate, days]);

  const max = Math.max(...bars.map((b) => b.cost), 0.001);

  // Label strategy: show "M/D" at the start, every ~7 days, and at
  // the end. Dense mode packs every bar so labels would collide; we
  // skip inner ones and rely on hover for exact dates.
  const labelIndices = useMemo(() => {
    const picks = new Set<number>();
    picks.add(0);
    picks.add(bars.length - 1);
    const step = Math.max(1, Math.floor(bars.length / 4));
    for (let i = step; i < bars.length - 1; i += step) picks.add(i);
    return picks;
  }, [bars.length]);

  return (
    <div className="relative">
      <div className="flex items-end gap-[2px]" style={{ height: heightPx }}>
        {bars.map((b, i) => {
          const h = max > 0 ? (b.cost / max) * 100 : 0;
          const active = b.cost > 0 && !b.isFuture;
          const barH = b.isFuture ? 4 : Math.max(active ? 10 : 4, h);
          const isHover = hovered === i;
          return (
            <div
              key={b.date}
              className="flex-1 min-w-0 rounded-t-sm relative cursor-default"
              style={{
                height: `${barH}%`,
                backgroundColor: b.isFuture
                  ? "var(--border)"
                  : active
                    ? "var(--usage-secondary)"
                    : "var(--border)",
                opacity: b.isFuture ? 0.3 : active ? 0.55 + (h / 100) * 0.45 : 0.35,
                transformOrigin: "bottom",
                transform: isHover && active ? "scaleY(1.06)" : "scaleY(1)",
                filter: isHover && active ? "brightness(1.25)" : "none",
                transition: "transform 0.15s ease, filter 0.15s ease",
                animation: animate
                  ? `usage-bar-grow 0.4s ease-out ${i * 8}ms both`
                  : undefined,
              }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              title={`${b.date}: ${fmtCost(b.cost)}`}
            />
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between text-[9px] text-[var(--text-faint)] tc-mono tc-num">
        {bars.map((b, i) =>
          labelIndices.has(i) ? (
            <span key={b.date}>
              {`${parseDateKey(b.date).getMonth() + 1}/${parseDateKey(b.date).getDate()}`}
            </span>
          ) : null,
        )}
      </div>

      {hovered !== null && bars[hovered] && bars[hovered].cost > 0 && (
        <div className="absolute top-0 right-0 text-[10px] bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-0.5 pointer-events-none tc-mono tc-num">
          <span className="text-[var(--text-secondary)]">
            {bars[hovered].date}
          </span>
          <span className="text-[var(--text-faint)] mx-1">·</span>
          <span className="text-[var(--text-primary)]">
            {fmtCost(bars[hovered].cost)}
          </span>
        </div>
      )}
    </div>
  );
}
