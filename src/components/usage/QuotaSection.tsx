import { useState, useEffect, useRef } from "react";
import { useQuotaStore } from "../../stores/quotaStore";
import { useT } from "../../i18n/useT";

function formatCountdown(resetsAt: string): string {
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return "now";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h`;
  }
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor((diff % 60_000) / 1000)).padStart(2, "0")}`;
}

function barColor(utilization: number): string {
  if (utilization > 0.8) return "#ef4444";
  if (utilization > 0.5) return "#eab308";
  return "#22c55e";
}

function QuotaBar({ utilization }: { utilization: number }) {
  const pct = Math.max(0, Math.min(100, utilization * 100));
  return (
    <div className="h-1.5 rounded-full bg-[var(--border)] flex-1 min-w-0 overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          backgroundColor: barColor(utilization),
          transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    </div>
  );
}

export function QuotaSection(): React.ReactElement | null {
  const { quota, loading, error } = useQuotaStore();
  const t = useT();
  const [, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  // Update countdown every 30 seconds
  useEffect(() => {
    if (!quota) return;
    intervalRef.current = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [quota]);

  if (!quota && !loading) return null;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
          {t.usage_quota}
        </span>
        {error === "rate_limited" && (
          <span className="text-[10px] text-[var(--text-faint)]" title="Rate limited, showing cached data">
            &#9203;
          </span>
        )}
      </div>

      {loading && !quota ? (
        <div className="mt-2 text-[10px] text-[var(--text-faint)]">{t.loading}</div>
      ) : quota ? (
        <div className="mt-2 flex flex-col gap-2">
          {/* 5-hour */}
          <div>
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] text-[var(--text-muted)] w-6 shrink-0 tabular-nums"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {t.usage_quota_5h}
              </span>
              <QuotaBar utilization={quota.fiveHour.utilization} />
              <span
                className="text-[10px] text-[var(--text-muted)] shrink-0 w-8 text-right tabular-nums"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {Math.round(quota.fiveHour.utilization * 100)}%
              </span>
            </div>
            <div
              className="text-[9px] text-[var(--text-faint)] mt-0.5 tabular-nums"
              style={{ fontFamily: '"Geist Mono", monospace', paddingLeft: 32 }}
            >
              {t.usage_quota_resets} {formatCountdown(quota.fiveHour.resetsAt)}
            </div>
          </div>

          {/* 7-day */}
          <div>
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] text-[var(--text-muted)] w-6 shrink-0 tabular-nums"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {t.usage_quota_7d}
              </span>
              <QuotaBar utilization={quota.sevenDay.utilization} />
              <span
                className="text-[10px] text-[var(--text-muted)] shrink-0 w-8 text-right tabular-nums"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {Math.round(quota.sevenDay.utilization * 100)}%
              </span>
            </div>
            <div
              className="text-[9px] text-[var(--text-faint)] mt-0.5 tabular-nums"
              style={{ fontFamily: '"Geist Mono", monospace', paddingLeft: 32 }}
            >
              {t.usage_quota_resets} {formatCountdown(quota.sevenDay.resetsAt)}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
