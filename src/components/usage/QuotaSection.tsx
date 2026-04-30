import { useState, useEffect, useRef } from "react";
import { useQuotaStore } from "../../stores/quotaStore";
import { useCodexQuotaStore } from "../../stores/codexQuotaStore";
import { useT } from "../../i18n/useT";
import type { QuotaData } from "../../types";

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
  if (utilization > 0.8) return "var(--usage-danger)";
  if (utilization > 0.5) return "var(--usage-cache)";
  return "var(--usage-secondary)";
}

function QuotaBar({ utilization }: { utilization: number }) {
  const pct = Math.max(0, Math.min(100, utilization * 100));
  return (
    <div
      className="h-1.5 rounded-full bg-[var(--border)] shrink-0 overflow-hidden"
      style={{ width: "clamp(56px, 30%, 104px)" }}
    >
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

function QuotaWindowRow({
  label,
  utilization,
  resetsAt,
}: {
  label: string;
  utilization: number;
  resetsAt: string;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] text-[var(--text-muted)] w-6 shrink-0 tc-mono tc-num">
        {label}
      </span>
      <QuotaBar utilization={utilization} />
      <span className="text-[10px] text-[var(--text-muted)] shrink-0 w-9 text-right tc-mono tc-num">
        {Math.round(utilization * 100)}%
      </span>
      <span className="text-[9px] text-[var(--text-faint)] tc-mono tc-num truncate">
        {t.usage_quota_resets} {formatCountdown(resetsAt)}
      </span>
    </div>
  );
}

function ProviderQuotaSection({
  title,
  quota,
  loading,
  error,
  inline = false,
}: {
  title: string;
  quota: QuotaData | null;
  loading: boolean;
  error: "rate_limited" | "unavailable" | null;
  inline?: boolean;
}) {
  const t = useT();

  if (!quota && !loading && !error) return null;

  return (
    <div className={inline ? "w-[min(300px,100%)] shrink-0" : undefined}>
      <div className="flex items-center gap-1.5">
        <span className="tc-eyebrow">{title}</span>
        {error === "rate_limited" && quota && (
          <span className="text-[10px] text-[var(--text-faint)]" title="Rate limited, showing cached data">
            &#9203;
          </span>
        )}
      </div>

      {loading && !quota ? (
        <div className="mt-2 tc-caption">{t.loading}</div>
      ) : quota ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <QuotaWindowRow
            label={t.usage_quota_5h}
            utilization={quota.fiveHour.utilization}
            resetsAt={quota.fiveHour.resetsAt}
          />
          <QuotaWindowRow
            label={t.usage_quota_7d}
            utilization={quota.sevenDay.utilization}
            resetsAt={quota.sevenDay.resetsAt}
          />
        </div>
      ) : error ? (
        <div className="mt-1.5 tc-caption">
          {error === "rate_limited" ? t.usage_quota_rate_limited : t.usage_quota_unavailable}
        </div>
      ) : null}
    </div>
  );
}

export function QuotaSection({
  inline = false,
}: {
  inline?: boolean;
}): React.ReactElement | null {
  const claudeQuota = useQuotaStore((s) => s.quota);
  const claudeLoading = useQuotaStore((s) => s.loading);
  const claudeError = useQuotaStore((s) => s.error);
  const codexQuota = useCodexQuotaStore((s) => s.quota);
  const codexLoading = useCodexQuotaStore((s) => s.loading);
  const codexError = useCodexQuotaStore((s) => s.error);
  const [, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);
  const t = useT();
  const hasAnyQuota = claudeQuota || codexQuota;
  const hasAnyError = claudeError || codexError;
  const isLoading = claudeLoading || codexLoading;

  useEffect(() => {
    if (!hasAnyQuota) return;
    intervalRef.current = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hasAnyQuota]);

  if (!hasAnyQuota && !isLoading && !hasAnyError) return null;

  return (
    <div
      className={
        inline
          ? "px-3 py-2 flex flex-wrap items-start gap-x-5 gap-y-2"
          : "px-3 py-2 flex flex-col gap-2"
      }
    >
      <ProviderQuotaSection
        title={t.usage_quota}
        quota={claudeQuota}
        loading={claudeLoading}
        error={claudeError}
        inline={inline}
      />
      <ProviderQuotaSection
        title={t.usage_quota_codex}
        quota={codexQuota}
        loading={codexLoading}
        error={codexError}
        inline={inline}
      />
    </div>
  );
}
