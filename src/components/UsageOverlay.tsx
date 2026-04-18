import { useEffect, useRef, useState, useCallback } from "react";
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
import {
  SummarySection,
  TimelineSection,
  CacheRateSection,
  ProjectsContent,
  ModelsContent,
  deriveActiveUsage,
} from "./UsagePanel";

/*
 * Usage, full-screen.
 *
 * Lives side-by-side with UsagePanel but intentionally diverges on
 * layout philosophy: the sidebar version is a tall narrow column
 * designed for at-a-glance monitoring while the canvas does the
 * real work; this overlay takes over the whole window so the user
 * can actually read charts and pivot across projects/models/cache
 * without squinting. Entering the overlay is an intentional action
 * (Cmd+Shift+U or the toolbar chart button) — not a passive peek.
 *
 * The data pipeline is identical to UsagePanel (same stores, same
 * `deriveActiveUsage` merge). What changes is the grid. A 12-column
 * flex/grid arrangement lets each section pick its own natural
 * width:
 *   • SparklineChart wants to be WIDE (time on x-axis)
 *   • SummarySection and Quota are compact boxes
 *   • Projects / Models / Cache are medium-width lists
 *   • TokenHeatmap is a wide ribbon (weeks × days)
 *
 * Closing: Esc, click-on-backdrop, or the ✕ button. All three need
 * to be reachable — modal-fatigue etiquette.
 */

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

  // Same polling strategy as the sidebar: fetch on open, refresh
  // every 5 minutes while open. Skip the first fetch if data is
  // already fresh (<30s old) so rapid toggling doesn't re-spam the
  // ingest pipeline.
  const lastFetchRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    if (summary && Date.now() - lastFetchRef.current < 30_000) return;
    lastFetchRef.current = Date.now();
    void fetchUsage();
    void quotaFetch();
    void codexQuotaFetch();
    if (isLoggedIn) void fetchCloud();
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
    quotaFetch,
    codexQuotaFetch,
    fetchCloud,
    fetchCloudHeatmap,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (summary) quotaOnCostChanged(summary.totalCost);
  }, [summary?.totalCost, quotaOnCostChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc to close. Capture phase + stopPropagation so a keystroke
  // inside the overlay (e.g. a focused button) can still opt out by
  // calling preventDefault, but other app-level listeners don't also
  // react to the same Esc (e.g. clearing the terminal focus).
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

  if (!open) return null;

  const { activeSummary, activeHeatmap } = deriveActiveUsage({
    isLoggedIn,
    summary,
    cloudSummary,
    heatmapData,
    cloudHeatmapData,
  });

  let monthlyCost = 0;
  if (activeHeatmap) {
    const monthPrefix = date.slice(0, 7);
    for (const [d, entry] of Object.entries(activeHeatmap)) {
      if (d.startsWith(monthPrefix)) monthlyCost += entry.cost;
    }
  }
  const monthlyData = monthlyCost > 0 ? { cost: monthlyCost } : undefined;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto usage-overlay-enter"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={t.usage_title}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[var(--bg)]/85 backdrop-blur-sm"
      />

      {/* Main content — stop propagation so clicks inside don't close */}
      <div
        className="relative w-full max-w-6xl mx-auto my-8 px-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header row */}
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

        {/* Control strip: date + insights + login */}
        <SectionCard className="mb-4">
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="flex-1 min-w-0">
              <DateNavigator
                date={date}
                cachedDates={cachedDates}
                onDateChange={handleDateChange}
              />
            </div>
            <InsightsButton compact />
            <LoginButton />
          </div>
        </SectionCard>

        {loading && !activeSummary ? (
          <div className="px-4 py-8 text-center text-[11px] text-[var(--text-faint)]">
            {t.loading}
          </div>
        ) : activeSummary ? (
          <div key={animKey} className="space-y-4">
            {/* Row 1: Summary + Timeline (summary narrow, timeline wide) */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-[minmax(260px,1fr)_2fr]">
              <SectionCard>
                <SummarySection
                  t={t}
                  summary={activeSummary}
                  monthlyData={monthlyData}
                />
              </SectionCard>
              <SectionCard>
                <TimelineSection t={t} summary={activeSummary} animate={true} />
              </SectionCard>
            </div>

            {/* Row 2: Quota + Cache rate */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
              <SectionCard>
                <QuotaSection />
              </SectionCard>
              {summary && (
                <SectionCard>
                  <CacheRateSection t={t} summary={summary} animate={true} />
                </SectionCard>
              )}
            </div>

            {/* Row 3: Projects + Models */}
            {(activeSummary.projects.length > 0 ||
              activeSummary.models.length > 0) && (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
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
            )}

            {/* Row 4: Heatmap (full width — fundamentally wide) */}
            <SectionCard title={t.usage_heatmap}>
              <TokenHeatmap
                animate={true}
                data={activeHeatmap ?? undefined}
                onVisible={() => {
                  void fetchHeatmap();
                  if (isLoggedIn) void fetchCloudHeatmap();
                }}
              />
            </SectionCard>

            {/* Row 5: Devices (only if logged in and multi-device data) */}
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
