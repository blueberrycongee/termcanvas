import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useUsageStore } from "../stores/usageStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useAuthStore } from "../stores/authStore";
import { useQuotaStore } from "../stores/quotaStore";
import { useCodexQuotaStore } from "../stores/codexQuotaStore";
import { useT } from "../i18n/useT";
import { DateNavigator } from "./usage/DateNavigator";
import { SparklineChart } from "./usage/SparklineChart";
import { TokenHeatmap } from "./usage/TokenHeatmap";
import { InsightsButton } from "./usage/InsightsButton";
import { LoginButton } from "./LoginButton";
import { DeviceBreakdown } from "./usage/DeviceBreakdown";
import { QuotaSection } from "./usage/QuotaSection";
import { MonthlyTrendChart } from "./usage/MonthlyTrendChart";
import {
  CacheRateSection,
  ProjectsContent,
  ModelsContent,
  deriveActiveUsage,
  fmtCost,
} from "./UsagePanel";

/**
 * Shared height for Row 2's hourly sparkline and the 30-day trend
 * chart. Must match between the two so their bar areas line up and
 * their x-axis labels render at the same Y position — otherwise the
 * side-by-side cards look visibly mismatched.
 */
const ROW2_CHART_HEIGHT = 56;

/*
 * Usage, full-screen.
 *
 * An earlier version composed a single-column right-sidebar layout
 * at overlay width, which left charts floating in awkward empty
 * space — they were designed for 260 px and looked sparse at 600 px.
 *
 * This version keeps every chart at its natural width and uses the
 * extra horizontal room to pack MORE information in, rather than
 * stretching the same few charts thinner.
 *
 * Reading order top-to-bottom:
 *
 *   1. Stat strip (4 cards):  today / month-to-date / daily avg /
 *                             end-of-month projection
 *                             — the numbers you open the dashboard
 *                             to check.
 *   2. Today's hourly spark + monthly daily bars (side by side)
 *                             — two complementary time zooms.
 *   3. Cache rate · projects · models (three narrow columns)
 *                             — tight bar charts, best at ~320 px.
 *   4. Quota                  — subscription budget meters, full row.
 *   5. Heatmap                — year-at-a-glance calendar ribbon.
 *   6. Devices (logged-in only) — multi-device breakdown.
 */

function StatCard({
  label,
  value,
  sub,
  subTone = "faint",
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "faint" | "muted" | "accent";
}) {
  const subColor =
    subTone === "accent"
      ? "var(--accent)"
      : subTone === "muted"
        ? "var(--text-muted)"
        : "var(--text-faint)";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div
        className="text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)] font-medium"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-[20px] font-semibold text-[var(--text-primary)] tabular-nums leading-none"
        style={{ fontFamily: '"Geist Mono", monospace', letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="mt-1 text-[10px] tabular-nums"
          style={{ fontFamily: '"Geist Mono", monospace', color: subColor }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden ${className}`}
    >
      {title && (
        <div
          className="px-3 py-2 border-b border-[var(--border)] text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {title}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

export function UsageOverlay() {
  const open = useCanvasStore((s) => s.usageOverlayOpen);
  const close = useCanvasStore((s) => s.closeUsageOverlay);
  const t = useT();

  const {
    summary,
    loading,
    date,
    cachedDates,
    fetch: fetchUsage,
    heatmapData,
    fetchHeatmap,
    cloudSummary,
    cloudHeatmapData,
    fetchCloud,
    fetchCloudHeatmap,
  } = useUsageStore();
  const { user, deviceId } = useAuthStore();
  const quotaFetch = useQuotaStore((s) => s.fetch);
  const quotaOnCostChanged = useQuotaStore((s) => s.onCostChanged);
  const codexQuotaFetch = useCodexQuotaStore((s) => s.fetch);

  const isLoggedIn = user !== null;

  const [animKey, setAnimKey] = useState(0);
  const prevDateRef = useRef(date);

  useEffect(() => {
    if (prevDateRef.current !== date) {
      prevDateRef.current = date;
      setAnimKey((k) => k + 1);
    }
  }, [date]);

  const lastFetchRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    if (summary && Date.now() - lastFetchRef.current < 30_000) return;
    lastFetchRef.current = Date.now();
    void fetchUsage();
    void quotaFetch();
    void codexQuotaFetch();
    if (isLoggedIn) void fetchCloud();
    // Also fetch heatmap on overlay open — MonthlyTrend and calendar
    // both need it, and the sidebar's lazy-on-visible pattern doesn't
    // apply here (everything renders at once).
    void fetchHeatmap();
    if (isLoggedIn) void fetchCloudHeatmap();
    const interval = setInterval(() => {
      lastFetchRef.current = Date.now();
      void fetchUsage();
      void codexQuotaFetch();
      if (isLoggedIn) {
        void fetchCloud();
        void fetchCloudHeatmap();
      }
    }, 5 * 60_000);
    return () => clearInterval(interval);
  }, [
    open,
    isLoggedIn,
    fetchUsage,
    fetchHeatmap,
    quotaFetch,
    codexQuotaFetch,
    fetchCloud,
    fetchCloudHeatmap,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (summary) quotaOnCostChanged(summary.totalCost);
  }, [summary?.totalCost, quotaOnCostChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  const handleDateChange = useCallback(
    (dateStr: string) => {
      fetchUsage(dateStr);
      if (isLoggedIn) fetchCloud(dateStr);
    },
    [fetchUsage, fetchCloud, isLoggedIn],
  );

  const { activeSummary, activeHeatmap } = deriveActiveUsage({
    isLoggedIn,
    summary,
    cloudSummary,
    heatmapData,
    cloudHeatmapData,
  });

  // Month-to-date + daily-average + projection. Derived from the
  // heatmap (one cost entry per day) for the calendar month the
  // viewing date belongs to.
  const monthStats = useMemo(() => {
    if (!activeHeatmap) {
      return { mtd: 0, daysWithData: 0, dailyAvg: 0, projection: 0 };
    }
    const monthPrefix = date.slice(0, 7); // YYYY-MM
    let mtd = 0;
    let daysWithData = 0;
    for (const [d, entry] of Object.entries(activeHeatmap)) {
      if (!d.startsWith(monthPrefix)) continue;
      if (entry.cost > 0) {
        mtd += entry.cost;
        daysWithData += 1;
      }
    }
    // Days elapsed in the viewing month so the "daily average" reads
    // as "per active day" rather than "per calendar day" — feels more
    // honest for people whose usage is bursty.
    const dailyAvg = daysWithData > 0 ? mtd / daysWithData : 0;
    const viewDate = new Date(date);
    const year = viewDate.getFullYear();
    const monthIdx = viewDate.getMonth();
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const isCurrentMonth = todayKey.startsWith(monthPrefix);
    const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth;
    const remainingDays = Math.max(0, daysInMonth - dayOfMonth);
    const projection =
      daysWithData > 0 && isCurrentMonth
        ? mtd + dailyAvg * remainingDays
        : mtd;
    return { mtd, daysWithData, dailyAvg, projection };
  }, [activeHeatmap, date]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto usage-overlay-enter"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={t.usage_title}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[var(--bg)]/85 backdrop-blur-sm"
      />

      <div
        className="relative w-full max-w-6xl mx-auto my-8 px-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <h1
            className="text-[18px] font-semibold text-[var(--text-primary)]"
            style={{ letterSpacing: "-0.01em" }}
          >
            {t.usage_title}
          </h1>
          <div className="flex-1" />
          <span
            className="text-[10px] text-[var(--text-faint)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            Esc
          </span>
          <button
            type="button"
            onClick={close}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            aria-label={t.right_panel_collapse}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3l6 6M9 3l-6 6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Control strip — DateNavigator is rendered bare so its own
            "USAGE" label + border-b don't fight with this card's
            chrome. Vertical padding (py-1.5) matches the inner
            heights of Insights/Login so the three controls sit on a
            shared baseline. */}
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-1.5">
            <div className="flex-1 min-w-0">
              <DateNavigator
                date={date}
                cachedDates={cachedDates}
                onDateChange={handleDateChange}
                bare
              />
            </div>
            <InsightsButton compact />
            <LoginButton />
          </div>
        </div>

        {loading && !activeSummary ? (
          <div className="px-4 py-8 text-center text-[11px] text-[var(--text-faint)]">
            {t.loading}
          </div>
        ) : activeSummary ? (
          <div key={animKey} className="space-y-4">
            {/* Row 1: Four-card stat strip. Each card sits at its
                natural narrow width (~240 px) — the container's
                extra width is absorbed by the gutter between
                cards rather than stretching the card internals. */}
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
              <StatCard
                label={(t.usage_stat_today as unknown as string) ?? "Today"}
                value={fmtCost(activeSummary.totalCost)}
                sub={`${activeSummary.sessions} ${t.usage_sessions} · ${activeSummary.totalOutput >= 1000 ? `${(activeSummary.totalOutput / 1000).toFixed(1)}K` : activeSummary.totalOutput} out`}
              />
              <StatCard
                label={(t.usage_stat_mtd as unknown as string) ?? "Month to date"}
                value={fmtCost(monthStats.mtd)}
                sub={
                  monthStats.daysWithData > 0
                    ? `${monthStats.daysWithData} ${(t.usage_stat_active_days as unknown as string) ?? "active days"}`
                    : undefined
                }
              />
              <StatCard
                label={(t.usage_stat_daily_avg as unknown as string) ?? "Daily avg"}
                value={fmtCost(monthStats.dailyAvg)}
                sub={(t.usage_stat_per_active_day as unknown as string) ?? "per active day"}
              />
              <StatCard
                label={
                  (t.usage_stat_projection as unknown as string) ??
                  "Projected month"
                }
                value={fmtCost(monthStats.projection)}
                sub={
                  monthStats.projection > monthStats.mtd
                    ? `+${fmtCost(monthStats.projection - monthStats.mtd)} ${(t.usage_stat_to_go as unknown as string) ?? "to go"}`
                    : (t.usage_stat_end_of_month as unknown as string) ??
                      "end of month"
                }
                subTone={monthStats.projection > monthStats.mtd ? "accent" : "faint"}
              />
            </div>

            {/* Row 2: Two time-zoom charts side by side. Hourly on
                left answers "when within today?", monthly on right
                answers "how does today compare to the past month?".
                Both charts share the same bar-area height so their
                x-axes land on the same baseline and the two cards
                come out the same height. */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
              <SectionCard title={t.usage_timeline}>
                <div className="px-3 py-2.5">
                  <SparklineChart
                    buckets={activeSummary.buckets}
                    animate={true}
                    date={activeSummary.date}
                    heightPx={ROW2_CHART_HEIGHT}
                  />
                </div>
              </SectionCard>
              <SectionCard
                title={
                  (t.usage_month_trend as unknown as string) ?? "Last 30 days"
                }
              >
                <div className="px-3 py-2.5">
                  <MonthlyTrendChart
                    heatmap={activeHeatmap}
                    focusDate={date}
                    days={30}
                    animate={true}
                    heightPx={ROW2_CHART_HEIGHT}
                  />
                </div>
              </SectionCard>
            </div>

            {/* Row 3: Three narrow bar-chart columns. These
                components (cache/projects/models) are designed for
                ~320 px — packing three across keeps each at its
                sweet spot instead of stretching one to 1000 px.
                CacheRateSection is rendered in `bare` mode so its
                first bar lines up vertically with the first row of
                Projects/Models; otherwise its internal title +
                margin pushed content ~20 px lower than its
                neighbours and the row looked ragged. */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
              {summary && (
                <SectionCard title={t.usage_cache_rate}>
                  <div className="px-3 py-2.5">
                    <CacheRateSection
                      t={t}
                      summary={summary}
                      animate={true}
                      bare
                    />
                  </div>
                </SectionCard>
              )}
              {activeSummary.projects.length > 0 && (
                <SectionCard title={t.usage_projects}>
                  <div className="px-3 py-2.5">
                    <ProjectsContent
                      t={t}
                      projects={activeSummary.projects}
                      totalCost={activeSummary.totalCost}
                      animate={true}
                    />
                  </div>
                </SectionCard>
              )}
              {activeSummary.models.length > 0 && (
                <SectionCard title={t.usage_models}>
                  <div className="px-3 py-2.5">
                    <ModelsContent
                      t={t}
                      models={activeSummary.models}
                      animate={true}
                    />
                  </div>
                </SectionCard>
              )}
            </div>

            {/* Row 4: Quota full-width. The budget meters carry a
                single data series per subscription — making them
                narrower wouldn't add density, just truncate labels. */}
            <SectionCard>
              <QuotaSection />
            </SectionCard>

            {/* Row 5: Heatmap full-width. A calendar ribbon is
                fundamentally wide. In the overlay we show a full
                year (size="large") so the ribbon actually uses the
                card's width instead of stranding ~800 px of empty
                space to the right, and we render the heatmap in
                `bare` mode to avoid a second "Token Heatmap" title
                inside SectionCard's title bar. */}
            <SectionCard title={t.usage_heatmap}>
              <TokenHeatmap
                animate={true}
                data={activeHeatmap ?? undefined}
                bare
                size="large"
              />
            </SectionCard>

            {/* Row 6: Multi-device breakdown, logged-in only. */}
            {isLoggedIn &&
              cloudSummary &&
              cloudSummary.devices.length > 0 && (
                <SectionCard title={t.auth_devices}>
                  <div className="px-3 py-2.5">
                    <DeviceBreakdown
                      devices={cloudSummary.devices}
                      localDeviceId={deviceId}
                    />
                  </div>
                </SectionCard>
              )}
            {isLoggedIn && !cloudSummary && (
              <div className="text-[10px] text-[var(--text-faint)] px-2">
                {t.auth_cloud_error}
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-[11px] text-[var(--text-faint)]">
            {t.usage_no_data}
          </div>
        )}
      </div>
    </div>
  );
}
