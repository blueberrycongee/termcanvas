import { useState, useRef } from "react";
import type { UsageBucket } from "../../types";
import { useT } from "../../i18n/useT";

function fmtCost(c: number): string {
  return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(3)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface SparklineChartProps {
  buckets: UsageBucket[];
  /** When true, bars animate in with stagger */
  animate: boolean;
}

export function SparklineChart({ buckets, animate }: SparklineChartProps) {
  const t = useT();
  const [hovered, setHovered] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const max = Math.max(...buckets.map((b) => b.cost), 0.001);
  const now = new Date();
  const currentHour = now.getHours();

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-end gap-px h-10">
        {buckets.map((b, i) => {
          const h = max > 0 ? Math.max(0, (b.cost / max) * 100) : 0;
          const isFuture = b.hourStart > currentHour;
          const isActive = b.calls > 0;
          const barH = isFuture ? 4 : Math.max(isActive ? 12 : 4, h);
          const isHovered = hovered === i;

          return (
            <div
              key={i}
              className="flex-1 min-w-0 rounded-t-sm cursor-default relative"
              style={{
                height: `${barH}%`,
                backgroundColor: isFuture
                  ? "var(--border)"
                  : isActive
                    ? "#0070f3"
                    : "var(--border)",
                opacity: isFuture ? 0.3 : isActive ? 0.5 + (h / 100) * 0.5 : 0.3,
                transformOrigin: "bottom",
                transform: isHovered && isActive ? "scaleY(1.08)" : "scaleY(1)",
                filter: isHovered && isActive ? "brightness(1.3)" : "none",
                transition: "transform 0.15s ease, filter 0.15s ease",
                animation: animate ? `usage-bar-grow 0.4s ease-out ${i * 15}ms both` : undefined,
              }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </div>

      {/* Tooltip */}
      {hovered !== null && buckets[hovered] && buckets[hovered].calls > 0 && (
        <SparklineTooltip
          bucket={buckets[hovered]}
          index={hovered}
          totalBars={buckets.length}
          containerRef={containerRef}
          callsLabel={t.usage_calls}
        />
      )}

      {/* Time axis */}
      <div
        className="flex justify-between mt-0.5 text-[9px] text-[var(--text-faint)]"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────

interface SparklineTooltipProps {
  bucket: UsageBucket;
  index: number;
  totalBars: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  callsLabel: string;
}

function SparklineTooltip({ bucket, index, totalBars, callsLabel }: SparklineTooltipProps) {
  // Position tooltip: center above the hovered bar, clamp to edges
  const pct = ((index + 0.5) / totalBars) * 100;
  const clampedPct = Math.max(20, Math.min(80, pct));

  const totalTokens = bucket.input + bucket.output + bucket.cacheRead + bucket.cacheCreate5m + bucket.cacheCreate1h;

  return (
    <div
      className="absolute bottom-full mb-1.5 pointer-events-none usage-tooltip-enter"
      style={{
        left: `${clampedPct}%`,
        transform: "translateX(-50%)",
        zIndex: 10,
      }}
    >
      <div
        className="rounded-md px-2 py-1.5 border border-[var(--border)] bg-[var(--surface)] shadow-lg whitespace-nowrap"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        <div className="text-[10px] text-[var(--text-secondary)] font-medium">{bucket.label}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-[var(--text-primary)]">{fmtCost(bucket.cost)}</span>
          <span className="text-[9px] text-[var(--text-muted)]">·</span>
          <span className="text-[10px] text-[var(--text-muted)]">{bucket.calls} {callsLabel}</span>
          {totalTokens > 0 && (
            <>
              <span className="text-[9px] text-[var(--text-muted)]">·</span>
              <span className="text-[10px] text-[var(--text-muted)]">{fmtTokens(totalTokens)}t</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
