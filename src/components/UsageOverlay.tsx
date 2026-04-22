import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useUsageStore } from "../stores/usageStore";
import { useCanvasStore, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
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
  fmtTokens,
} from "./UsagePanel";

/*
 * Usage, full-screen.
 *
 * Reads as a canvas pane — pinned between the left/right side
 * panels, not an overlay with a backdrop — so the rest of the app
 * stays in place while you glance at spend.
 *
 * Layout is container-query driven: the outer shell declares
 * `container-type: inline-size` (via `@container`) and every grid
 * below uses `@[NNNpx]:` variants so the layout reacts to the
 * *available gap*, not the browser viewport. That matters here
 * because either side panel can be collapsed or dragged, and the
 * viewport-based md:/lg: breakpoints we used to have would fire on
 * a 1920px monitor even when the gap between panels was 640px.
 *
 * Breakpoints, chosen by eyeballing minimum legible widths:
 *   < 640  → compact fallback (single-column essentials only —
 *            replaces the previous `return null` which left users
 *            wondering why ⌘⇧U did nothing).
 *   ≥ 520  → 2-col stat strip.
 *   ≥ 760  → 2-col chart row (hourly + 30-day).
 *   ≥ 840  → 4-col stat strip (today / MTD / daily avg / projection).
 *   ≥ 900  → 3-col bar row (cache / projects / models) +
 *            looser outer padding (px-7 vs px-5).
 *
 * Reading order: totals first, then time-zoom charts, then the
 * tight bar-chart trio, then budget, then the year ribbon, then
 * devices.
 */

const USAGE_COMPACT_MAX = 640;
const ROW2_CHART_HEIGHT = 64;

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
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition-colors hover:border-[var(--border-hover)]">
      <div className="tc-eyebrow tc-mono">{label}</div>
      <div className="mt-2 tc-stat-xl">{value}</div>
      {sub && (
        <div className="mt-1.5 tc-caption tc-mono tc-num" style={{ color: subColor }}>
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
        <div className="px-4 py-2.5 border-b border-[var(--border)] tc-eyebrow tc-mono">
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
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);
  const rightPanelWidth = useCanvasStore((s) => s.rightPanelWidth);
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
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const onResize = () => setResizeTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

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

  const monthStats = useMemo(() => {
    if (!activeHeatmap) {
      return { mtd: 0, daysWithData: 0, dailyAvg: 0, projection: 0 };
    }
    const monthPrefix = date.slice(0, 7);
    let mtd = 0;
    let daysWithData = 0;
    for (const [d, entry] of Object.entries(activeHeatmap)) {
      if (!d.startsWith(monthPrefix)) continue;
      if (entry.cost > 0) {
        mtd += entry.cost;
        daysWithData += 1;
      }
    }
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

  const leftInset = leftPanelCollapsed ? COLLAPSED_TAB_WIDTH : leftPanelWidth;
  const rightInset = rightPanelCollapsed
    ? COLLAPSED_TAB_WIDTH
    : rightPanelWidth;
  const gapWidth =
    typeof window !== "undefined"
      ? window.innerWidth - leftInset - rightInset
      : 1024;
  const isCompact = gapWidth < USAGE_COMPACT_MAX;

  // Labels — resolved once up top so both variants below read the
  // same text without peppering `as unknown as string` fallbacks.
  const labelToday = (t.usage_stat_today as unknown as string) ?? "Today";
  const labelMtd =
    (t.usage_stat_mtd as unknown as string) ?? "Month to date";
  const labelDailyAvg =
    (t.usage_stat_daily_avg as unknown as string) ?? "Daily avg";
  const labelProjection =
    (t.usage_stat_projection as unknown as string) ?? "Projected month";
  const labelActiveDays =
    (t.usage_stat_active_days as unknown as string) ?? "active days";
  const labelPerActiveDay =
    (t.usage_stat_per_active_day as unknown as string) ?? "per active day";
  const labelEndOfMonth =
    (t.usage_stat_end_of_month as unknown as string) ?? "end of month";
  const labelToGo = (t.usage_stat_to_go as unknown as string) ?? "to go";
  const labelMonthTrend =
    (t.usage_month_trend as unknown as string) ?? "Last 30 days";

  return (
    /*
      Container-query root. `@container` gives children access to
      `@[NNNpx]:` variants that respond to THIS element's inline
      size — not the browser viewport — which is the right axis for
      a pane sandwiched between two user-resizable side panels.
    */
    <div
      className="fixed z-[55] bg-[var(--bg)] overflow-y-auto usage-overlay-enter @container"
      style={{
        top: 44,
        left: leftInset,
        right: rightInset,
        height: "calc(100vh - 44px)",
      }}
      role="dialog"
      aria-modal="false"
      aria-label={t.usage_title}
    >
      <div
        className={`relative w-full mx-auto ${
          isCompact
            ? "px-4 py-5 max-w-[520px]"
            : "px-5 @[900px]:px-7 py-6 @[900px]:py-8 max-w-[1280px]"
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <h1 className="tc-display">{t.usage_title}</h1>
          <div className="flex-1" />
          <span className="tc-caption tc-mono">Esc</span>
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

        {/* Control strip */}
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
          <div className="px-4 py-8 text-center tc-caption">{t.loading}</div>
        ) : activeSummary ? (
          isCompact ? (
            /*
              Compact fallback. Rendered when the canvas gap is too
              narrow for the full dashboard to read well. Keeps the
              same data model but cuts the grid rows to a single
              column of essentials: hero total, today's hourly
              spark, budget, and a 13-week ribbon. The heatmap
              component auto-sizes to whatever inline space it has.
            */
            <div key={animKey} className="flex flex-col gap-4">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                <div className="tc-eyebrow tc-mono">{labelToday}</div>
                <div className="mt-2 tc-stat-xl">
                  {fmtCost(activeSummary.totalCost)}
                </div>
                <div className="mt-2 tc-caption tc-mono tc-num flex items-center gap-2">
                  <span>
                    {activeSummary.sessions} {t.usage_sessions}
                  </span>
                  <span className="text-[var(--text-faint)]">·</span>
                  <span>{fmtTokens(activeSummary.totalOutput)} out</span>
                  {monthStats.mtd > 0 && (
                    <>
                      <span className="text-[var(--text-faint)]">·</span>
                      <span>
                        {fmtCost(monthStats.mtd)} {labelMtd.toLowerCase()}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <SectionCard title={t.usage_timeline}>
                <div className="px-4 py-3">
                  <SparklineChart
                    buckets={activeSummary.buckets}
                    animate={true}
                    date={activeSummary.date}
                    heightPx={56}
                  />
                </div>
              </SectionCard>

              <SectionCard>
                <QuotaSection />
              </SectionCard>

              <SectionCard title={t.usage_heatmap}>
                <TokenHeatmap
                  animate={true}
                  data={activeHeatmap ?? undefined}
                  bare
                  size="auto"
                />
              </SectionCard>
            </div>
          ) : (
            <div key={animKey} className="flex flex-col gap-4 @[900px]:gap-5">
              {/* Row 1: stat strip — 1 col → 2 col → 4 col */}
              <div className="grid gap-4 grid-cols-1 @[520px]:grid-cols-2 @[840px]:grid-cols-4">
                <StatCard
                  label={labelToday}
                  value={fmtCost(activeSummary.totalCost)}
                  sub={`${activeSummary.sessions} ${t.usage_sessions} · ${
                    activeSummary.totalOutput >= 1000
                      ? `${(activeSummary.totalOutput / 1000).toFixed(1)}K`
                      : activeSummary.totalOutput
                  } out`}
                />
                <StatCard
                  label={labelMtd}
                  value={fmtCost(monthStats.mtd)}
                  sub={
                    monthStats.daysWithData > 0
                      ? `${monthStats.daysWithData} ${labelActiveDays}`
                      : undefined
                  }
                />
                <StatCard
                  label={labelDailyAvg}
                  value={fmtCost(monthStats.dailyAvg)}
                  sub={labelPerActiveDay}
                />
                <StatCard
                  label={labelProjection}
                  value={fmtCost(monthStats.projection)}
                  sub={
                    monthStats.projection > monthStats.mtd
                      ? `+${fmtCost(monthStats.projection - monthStats.mtd)} ${labelToGo}`
                      : labelEndOfMonth
                  }
                  subTone={
                    monthStats.projection > monthStats.mtd ? "accent" : "faint"
                  }
                />
              </div>

              {/* Row 2: two time-zoom charts, stacked below 760 */}
              <div className="grid gap-4 grid-cols-1 @[760px]:grid-cols-2">
                <SectionCard title={t.usage_timeline}>
                  <div className="px-4 py-3">
                    <SparklineChart
                      buckets={activeSummary.buckets}
                      animate={true}
                      date={activeSummary.date}
                      heightPx={ROW2_CHART_HEIGHT}
                    />
                  </div>
                </SectionCard>
                <SectionCard title={labelMonthTrend}>
                  <div className="px-4 py-3">
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

              {/* Row 3: narrow bar-chart trio, stacked below 900 */}
              <div className="grid gap-4 grid-cols-1 @[900px]:grid-cols-3">
                {summary && (
                  <SectionCard title={t.usage_cache_rate}>
                    <div className="px-4 py-3">
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
                    <div className="px-4 py-3">
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
                    <div className="px-4 py-3">
                      <ModelsContent
                        t={t}
                        models={activeSummary.models}
                        animate={true}
                      />
                    </div>
                  </SectionCard>
                )}
              </div>

              {/* Row 4: Quota — full-width */}
              <SectionCard>
                <QuotaSection />
              </SectionCard>

              {/* Row 5: Heatmap — full-width, self-sizing */}
              <SectionCard title={t.usage_heatmap}>
                <TokenHeatmap
                  animate={true}
                  data={activeHeatmap ?? undefined}
                  bare
                  size="auto"
                />
              </SectionCard>

              {/* Row 6: Devices — logged-in only */}
              {isLoggedIn &&
                cloudSummary &&
                cloudSummary.devices.length > 0 && (
                  <SectionCard title={t.auth_devices}>
                    <div className="px-4 py-3">
                      <DeviceBreakdown
                        devices={cloudSummary.devices}
                        localDeviceId={deviceId}
                      />
                    </div>
                  </SectionCard>
                )}
              {isLoggedIn && !cloudSummary && (
                <div className="tc-caption px-2">{t.auth_cloud_error}</div>
              )}
            </div>
          )
        ) : (
          <div className="px-4 py-8 text-center tc-caption">
            {t.usage_no_data}
          </div>
        )}
      </div>
    </div>
  );
}
