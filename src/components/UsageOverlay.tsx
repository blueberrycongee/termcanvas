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
import { UsageRangeTrendChart } from "./usage/UsageRangeTrendChart";
import {
  CacheRateSection,
  ProjectsContent,
  ModelsContent,
  deriveActiveUsage,
  fmtCost,
  fmtTokens,
  totalSummaryTokens,
} from "./UsagePanel";
import type { UsageRangeSummary } from "../types";
import type { HeatmapEntry } from "../stores/usageStore";

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
 *   ≥ 900  → overview + compact quota, then chart and composition rows.
 *
 * Reading order: totals first, then time-zoom charts, then the
 * tight bar-chart trio, then budget, then the year ribbon, then
 * devices.
 */

const USAGE_COMPACT_MAX = 640;
const ROW2_CHART_HEIGHT = 64;
type UsagePeriodMode = "day" | "thisMonth" | "lastMonth";

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthRange(mode: Exclude<UsagePeriodMode, "day">): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (mode === "thisMonth") {
    return {
      startDate: dateKey(new Date(year, month, 1)),
      endDate: dateKey(now),
    };
  }
  return {
    startDate: dateKey(new Date(year, month - 1, 1)),
    endDate: dateKey(new Date(year, month, 0)),
  };
}

function totalRangeTokens(summary: UsageRangeSummary): number {
  return (
    summary.totalInput +
    summary.totalOutput +
    summary.totalCacheRead +
    summary.totalCacheCreate5m +
    summary.totalCacheCreate1h
  );
}

function enumerateDateKeys(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const dates: string[] = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return dates;
  }
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(dateKey(d));
  }
  return dates;
}

function withHeatmapDays(
  summary: UsageRangeSummary,
  heatmap: Record<string, HeatmapEntry> | null,
): UsageRangeSummary {
  if (!heatmap) return summary;
  return {
    ...summary,
    days: enumerateDateKeys(summary.startDate, summary.endDate).map((date) => {
      const entry = heatmap[date];
      return {
        date,
        input: 0,
        output: entry?.tokens ?? 0,
        cacheRead: 0,
        cacheCreate5m: 0,
        cacheCreate1h: 0,
        cost: entry?.cost ?? 0,
        calls: 0,
      };
    }),
  };
}

function chooseRangeSummary({
  local,
  cloud,
  cloudHeatmap,
  range,
}: {
  local: UsageRangeSummary | null;
  cloud: UsageRangeSummary | null;
  cloudHeatmap: Record<string, HeatmapEntry> | null;
  range: { startDate: string; endDate: string } | null;
}): UsageRangeSummary | null {
  const matchingLocal =
    range &&
    local?.startDate === range.startDate &&
    local.endDate === range.endDate
      ? local
      : null;
  const matchingCloud =
    range &&
    cloud?.startDate === range.startDate &&
    cloud.endDate === range.endDate
      ? withHeatmapDays(cloud, cloudHeatmap)
      : null;
  if (matchingCloud && matchingLocal) {
    return matchingCloud.totalCost >= matchingLocal.totalCost
      ? matchingCloud
      : matchingLocal;
  }
  return matchingCloud ?? matchingLocal;
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

function MetricPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 min-w-0">
      <div className="tc-caption tc-mono text-[var(--text-faint)] truncate">
        {label}
      </div>
      <div
        className="mt-1 text-[13px] font-semibold tc-mono tc-num truncate"
        style={{
          color:
            tone === "accent" ? "var(--usage-primary)" : "var(--text-primary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function OverviewCard({
  label,
  costLabel,
  cost,
  tokenLabel,
  tokens,
  sessions,
  children,
}: {
  label: string;
  costLabel: string;
  cost: string;
  tokenLabel: string;
  tokens: string;
  sessions: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
      <div className="tc-eyebrow tc-mono">{label}</div>
      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="tc-caption tc-mono text-[var(--text-faint)]">
            {costLabel}
          </div>
          <div className="mt-1 tc-stat-xl">{cost}</div>
        </div>
        <div>
          <div className="tc-caption tc-mono text-[var(--text-faint)]">
            {tokenLabel}
          </div>
          <div className="mt-1 tc-stat-xl">{tokens}</div>
        </div>
        <div className="pb-1 tc-caption tc-mono tc-num text-[var(--text-muted)]">
          {sessions}
        </div>
      </div>
      {children && (
        <div className="mt-4 grid gap-2 grid-cols-2 @[760px]:grid-cols-4">
          {children}
        </div>
      )}
    </section>
  );
}

function UsageRangeDashboard({
  summary,
  periodLabel,
  t,
  animate,
}: {
  summary: UsageRangeSummary;
  periodLabel: string;
  t: ReturnType<typeof useT>;
  animate: boolean;
}): React.ReactElement {
  const totalTokens = totalRangeTokens(summary);
  const activeDays = summary.days.filter((day) => day.cost > 0).length;
  const dailyAvgCost =
    activeDays > 0 ? summary.totalCost / activeDays : 0;
  const dailyAvgTokens = activeDays > 0 ? totalTokens / activeDays : 0;
  const cacheCreate =
    summary.totalCacheCreate5m + summary.totalCacheCreate1h;
  const hasUsage = totalTokens > 0 || summary.totalCost > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 grid-cols-1 @[980px]:grid-cols-[minmax(0,1fr)_auto] items-start">
        <OverviewCard
          label={`${periodLabel} · ${summary.startDate} - ${summary.endDate}`}
          costLabel={t.usage_cost ?? "Cost"}
          cost={fmtCost(summary.totalCost)}
          tokenLabel={t.usage_tokens}
          tokens={fmtTokens(totalTokens)}
          sessions={`${summary.sessions} ${t.usage_sessions}`}
        >
          <MetricPill
            label={t.usage_stat_daily_avg}
            value={`${fmtCost(dailyAvgCost)} / ${fmtTokens(dailyAvgTokens)}t`}
          />
          <MetricPill
            label={t.usage_stat_active_days}
            value={String(activeDays)}
          />
          <MetricPill
            label={t.usage_cache_read}
            value={fmtTokens(summary.totalCacheRead)}
          />
          <MetricPill
            label={t.usage_cache_create}
            value={fmtTokens(cacheCreate)}
          />
        </OverviewCard>
        <QuotaSection inline framed />
      </div>

      {!hasUsage ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center tc-caption">
          {t.usage_no_data}
        </div>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-1 @[760px]:grid-cols-2">
            <SectionCard title={`${periodLabel} · ${t.usage_month_trend}`}>
              <div className="px-4 py-3">
                <UsageRangeTrendChart
                  days={summary.days}
                  metric="cost"
                  animate={animate}
                />
              </div>
            </SectionCard>
            <SectionCard title={`${periodLabel} · ${t.usage_tokens}`}>
              <div className="px-4 py-3">
                <UsageRangeTrendChart
                  days={summary.days}
                  metric="tokens"
                  animate={animate}
                />
              </div>
            </SectionCard>
          </div>

          <div className="grid gap-4 grid-cols-1 @[900px]:grid-cols-2">
            {summary.projects.length > 0 && (
              <SectionCard title={t.usage_projects}>
                <div className="px-4 py-3">
                  <ProjectsContent
                    t={t}
                    projects={summary.projects}
                    totalCost={summary.totalCost}
                    animate={animate}
                  />
                </div>
              </SectionCard>
            )}
            {summary.models.length > 0 && (
              <SectionCard title={t.usage_models}>
                <div className="px-4 py-3">
                  <ModelsContent
                    t={t}
                    models={summary.models}
                    animate={animate}
                  />
                </div>
              </SectionCard>
            )}
          </div>
        </>
      )}
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
    rangeSummary,
    rangeLoading,
    fetchRange,
    heatmapData,
    fetchHeatmap,
    cloudSummary,
    cloudRangeSummary,
    cloudHeatmapData,
    fetchCloud,
    fetchCloudRange,
    fetchCloudHeatmap,
  } = useUsageStore();
  const { user, deviceId } = useAuthStore();
  const quotaFetch = useQuotaStore((s) => s.fetch);
  const quotaOnCostChanged = useQuotaStore((s) => s.onCostChanged);
  const codexQuotaFetch = useCodexQuotaStore((s) => s.fetch);

  const isLoggedIn = user !== null;
  const [periodMode, setPeriodMode] = useState<UsagePeriodMode>("day");

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

  const activeRange = useMemo(
    () => (periodMode === "day" ? null : monthRange(periodMode)),
    [periodMode],
  );

  useEffect(() => {
    if (!open || !activeRange) return;
    void fetchRange(activeRange.startDate, activeRange.endDate);
    if (isLoggedIn) {
      void fetchCloudRange(activeRange.startDate, activeRange.endDate);
      void fetchCloudHeatmap();
    }
  }, [
    open,
    activeRange,
    isLoggedIn,
    fetchRange,
    fetchCloudRange,
    fetchCloudHeatmap,
  ]);

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
      return {
        mtd: 0,
        mtdTokens: 0,
        daysWithData: 0,
      };
    }
    const monthPrefix = date.slice(0, 7);
    let mtd = 0;
    let mtdTokens = 0;
    let daysWithData = 0;
    for (const [d, entry] of Object.entries(activeHeatmap)) {
      if (!d.startsWith(monthPrefix)) continue;
      if (entry.cost > 0) {
        mtd += entry.cost;
        mtdTokens += entry.tokens;
        daysWithData += 1;
      }
    }
    return { mtd, mtdTokens, daysWithData };
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
  const labelMtd = (t.usage_stat_mtd as unknown as string) ?? "Month to date";
  const labelActiveDays =
    (t.usage_stat_active_days as unknown as string) ?? "active days";
  const labelMonthTrend =
    (t.usage_month_trend as unknown as string) ?? "Last 30 days";
  const labelPeriodDay =
    (t.usage_period_day as unknown as string) ?? t.usage_today;
  const labelPeriodThisMonth =
    (t.usage_period_this_month as unknown as string) ?? t.usage_monthly;
  const labelPeriodLastMonth =
    (t.usage_period_last_month as unknown as string) ?? "Last month";
  const activeTotalTokens = activeSummary
    ? totalSummaryTokens(activeSummary)
    : 0;
  const activeRangeSummary = chooseRangeSummary({
    local: rangeSummary,
    cloud: isLoggedIn ? cloudRangeSummary : null,
    cloudHeatmap: isLoggedIn ? cloudHeatmapData : null,
    range: activeRange,
  });
  const periodLabel =
    periodMode === "day"
      ? labelPeriodDay
      : periodMode === "thisMonth"
        ? labelPeriodThisMonth
        : labelPeriodLastMonth;

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
            : "px-5 @[900px]:px-7 py-6 @[900px]:py-8 max-w-[1120px]"
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
          <div className="flex flex-wrap items-center gap-3 px-3 py-1.5">
            <div className="flex items-center gap-1 rounded-md bg-[var(--bg)] p-0.5 border border-[var(--border)]">
              {[
                ["day", labelPeriodDay],
                ["thisMonth", labelPeriodThisMonth],
                ["lastMonth", labelPeriodLastMonth],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPeriodMode(mode as UsagePeriodMode)}
                  className={`px-2.5 py-1 rounded text-[10px] tc-mono transition-colors ${
                    periodMode === mode
                      ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-[220px]">
              {periodMode === "day" ? (
                <DateNavigator
                  date={date}
                  cachedDates={cachedDates}
                  onDateChange={handleDateChange}
                  bare
                />
              ) : activeRange ? (
                <div className="tc-caption tc-mono tc-num text-[var(--text-muted)] truncate">
                  {activeRange.startDate} - {activeRange.endDate}
                </div>
              ) : null}
            </div>
            <InsightsButton compact />
            <LoginButton />
          </div>
        </div>

        {periodMode !== "day" ? (
          rangeLoading && !activeRangeSummary ? (
            <div
              className="px-4 py-8 text-center tc-caption"
              role="status"
              aria-live="polite"
            >
              {t.loading}
            </div>
          ) : activeRangeSummary ? (
            <UsageRangeDashboard
              key={`${periodMode}:${activeRangeSummary.startDate}:${activeRangeSummary.endDate}`}
              summary={activeRangeSummary}
              periodLabel={periodLabel}
              t={t}
              animate={true}
            />
          ) : (
            <div className="px-4 py-8 text-center tc-caption">
              {t.usage_no_data}
            </div>
          )
        ) : loading && !activeSummary ? (
          <div
            className="px-4 py-8 text-center tc-caption"
            role="status"
            aria-live="polite"
          >
            {t.loading}
          </div>
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
                    {fmtTokens(activeTotalTokens)} {t.usage_tokens}
                  </span>
                  <span className="text-[var(--text-faint)]">·</span>
                  <span>
                    {activeSummary.sessions} {t.usage_sessions}
                  </span>
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

              <QuotaSection inline framed />

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
            <div key={animKey} className="flex flex-col gap-4">
              <div className="grid gap-4 grid-cols-1 @[980px]:grid-cols-[minmax(0,1fr)_auto] items-start">
                <OverviewCard
                  label={labelToday}
                  costLabel={t.usage_cost ?? "Cost"}
                  cost={fmtCost(activeSummary.totalCost)}
                  tokenLabel={t.usage_tokens}
                  tokens={fmtTokens(activeTotalTokens)}
                  sessions={`${activeSummary.sessions} ${t.usage_sessions}`}
                >
                  <MetricPill
                    label={t.usage_input}
                    value={fmtTokens(activeSummary.totalInput)}
                  />
                  <MetricPill
                    label={t.usage_output}
                    value={fmtTokens(activeSummary.totalOutput)}
                  />
                  <MetricPill
                    label={labelMtd}
                    value={`${fmtCost(monthStats.mtd)} · ${fmtTokens(monthStats.mtdTokens)}t`}
                    tone="accent"
                  />
                  <MetricPill
                    label={labelActiveDays}
                    value={String(monthStats.daysWithData)}
                  />
                </OverviewCard>
                <QuotaSection inline framed />
              </div>

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

              <div className="grid gap-4 grid-cols-1 @[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start">
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
                <SectionCard title={t.usage_heatmap} className="w-fit max-w-full">
                  <TokenHeatmap
                    animate={true}
                    data={activeHeatmap ?? undefined}
                    bare
                    size="default"
                  />
                </SectionCard>
              </div>

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
