import { useMemo, useState } from "react";
import type { UsageRangeDay } from "../../types";
import { fmtCost, fmtTokens, totalUsageTokens } from "../UsagePanel";

function parseDateKey(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shortDateLabel(date: string): string {
  const parsed = parseDateKey(date);
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

interface UsageRangeTrendChartProps {
  days: UsageRangeDay[];
  metric: "cost" | "tokens";
  animate?: boolean;
  heightPx?: number;
}

export function UsageRangeTrendChart({
  days,
  metric,
  animate = true,
  heightPx = 72,
}: UsageRangeTrendChartProps): React.ReactElement {
  const [hovered, setHovered] = useState<number | null>(null);
  const values = useMemo(
    () =>
      days.map((day) =>
        metric === "cost" ? day.cost : totalUsageTokens(day),
      ),
    [days, metric],
  );
  const max = Math.max(...values, 0.001);
  const labelIndices = useMemo(() => {
    const picks = new Set<number>();
    if (days.length === 0) return picks;
    picks.add(0);
    picks.add(days.length - 1);
    const step = Math.max(1, Math.floor(days.length / 4));
    for (let i = step; i < days.length - 1; i += step) picks.add(i);
    return picks;
  }, [days.length]);

  return (
    <div className="relative">
      <div className="flex items-end gap-[2px]" style={{ height: heightPx }}>
        {days.map((day, index) => {
          const value = values[index] ?? 0;
          const active = value > 0;
          const height = max > 0 ? (value / max) * 100 : 0;
          const barHeight = Math.max(active ? 10 : 4, height);
          const isHovered = hovered === index;
          return (
            <div
              key={day.date}
              className="flex-1 min-w-[3px] rounded-t-sm cursor-default"
              style={{
                height: `${barHeight}%`,
                backgroundColor: active
                  ? metric === "cost"
                    ? "var(--usage-primary)"
                    : "var(--usage-secondary)"
                  : "var(--border)",
                opacity: active ? 0.55 + (height / 100) * 0.45 : 0.35,
                transformOrigin: "bottom",
                transform: isHovered && active ? "scaleY(1.06)" : "scaleY(1)",
                filter: isHovered && active ? "brightness(1.25)" : "none",
                transition: "transform 0.15s ease, filter 0.15s ease",
                animation: animate
                  ? `usage-bar-grow 0.4s ease-out ${index * 6}ms both`
                  : undefined,
              }}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-[var(--text-faint)] tc-mono tc-num">
        {days.map((day, index) =>
          labelIndices.has(index) ? (
            <span key={day.date}>{shortDateLabel(day.date)}</span>
          ) : null,
        )}
      </div>
      {hovered !== null && days[hovered] && values[hovered] > 0 && (
        <div className="absolute top-0 right-0 text-[10px] bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-0.5 pointer-events-none tc-mono tc-num">
          <span className="text-[var(--text-secondary)]">
            {days[hovered].date}
          </span>
          <span className="text-[var(--text-faint)] mx-1">·</span>
          <span className="text-[var(--text-primary)]">
            {fmtCost(days[hovered].cost)}
          </span>
          <span className="text-[var(--text-faint)] mx-1">·</span>
          <span className="text-[var(--text-muted)]">
            {fmtTokens(totalUsageTokens(days[hovered]))}t
          </span>
        </div>
      )}
    </div>
  );
}
