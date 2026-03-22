import { useEffect, useCallback, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useUsageStore } from "../stores/usageStore";
import { useCanvasStore, RIGHT_PANEL_WIDTH, COLLAPSED_TAB_WIDTH } from "../stores/canvasStore";
import { useAuthStore } from "../stores/authStore";
import { useT } from "../i18n/useT";
import { DateNavigator } from "./usage/DateNavigator";
import { SparklineChart } from "./usage/SparklineChart";
import { TokenHeatmap } from "./usage/TokenHeatmap";
import { InsightsButton } from "./usage/InsightsButton";
import { LoginButton } from "./LoginButton";
import { DeviceBreakdown } from "./usage/DeviceBreakdown";
import { QuotaSection } from "./usage/QuotaSection";
import { mergeUsageHeatmaps } from "./usage/heatmap-utils";
import { useQuotaStore } from "../stores/quotaStore";
import type { UsageSummary, ProjectUsage, ModelUsage } from "../types";

// ── Helpers ────────────────────────────────────────────────────────────

function fmtCost(c: number): string {
  return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(3)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pct(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

// ── Animated cost number ──────────────────────────────────────────────

function useAnimatedNumber(target: number, duration = 400): number {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef(0);
  const prevRef = useRef(target);

  useEffect(() => {
    const from = prevRef.current;
    const to = target;
    prevRef.current = to;

    if (from === to) return;

    const start = performance.now();
    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      // ease-out cubic
      const t = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * t);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

// ── Bar component ──────────────────────────────────────────────────────

function Bar({
  value,
  max,
  color = "var(--accent)",
  animate,
  delay = 0,
}: {
  value: number;
  max: number;
  color?: string;
  animate?: boolean;
  delay?: number;
}) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 rounded-full bg-[var(--border)] flex-1 min-w-0 overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{
          width: `${w}%`,
          backgroundColor: color,
          transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
          animation: animate ? `usage-bar-fill 0.5s ease-out ${delay}ms both` : undefined,
        }}
      />
    </div>
  );
}

// ── Hover tooltip wrapper ─────────────────────────────────────────────

function HoverDetail({ children, tooltip }: { children: React.ReactNode; tooltip: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; flipUp: boolean } | null>(null);

  useEffect(() => {
    if (!show || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < 60;
    setPos({
      top: flipUp ? rect.top : rect.bottom + 2,
      left: rect.left + rect.width / 2,
      flipUp,
    });
  }, [show]);

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el || !show) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    if (rect.right > window.innerWidth - margin) {
      el.style.left = `${parseFloat(el.style.left) - (rect.right - (window.innerWidth - margin))}px`;
    } else if (rect.left < margin) {
      el.style.left = `${parseFloat(el.style.left) + (margin - rect.left)}px`;
    }
  });

  return (
    <div
      ref={triggerRef}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && pos && createPortal(
        <div
          ref={tooltipRef}
          className="fixed z-[9999] pointer-events-none usage-tooltip-enter"
          style={{
            top: pos.flipUp ? undefined : pos.top,
            bottom: pos.flipUp ? window.innerHeight - pos.top + 2 : undefined,
            left: pos.left,
            transform: "translateX(-50%)",
          }}
        >
          <div className="rounded-md px-2 py-1 border border-[var(--border)] bg-[var(--surface)] shadow-lg">
            {tooltip}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Collapsible section wrapper ────────────────────────────────────────

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="px-3 py-2.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full cursor-pointer"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          className="text-[var(--text-faint)] shrink-0 transition-transform duration-150"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <path d="M2 1L6 4L2 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
          {title}
        </span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ── Section components ─────────────────────────────────────────────────

function SummarySection({ t, summary, monthlyData }: { t: ReturnType<typeof useT>; summary: UsageSummary; monthlyData?: { cost: number } }) {
  const animatedCost = useAnimatedNumber(summary.totalCost);

  return (
    <div className="px-3 pt-2 pb-3">
      <div className="flex items-baseline justify-between">
        <span
          className="text-[24px] font-semibold text-[var(--text-primary)] tabular-nums"
          style={{ fontFamily: '"Geist Mono", monospace', letterSpacing: "-0.02em" }}
        >
          {fmtCost(animatedCost)}
        </span>
        <span className="text-[11px] text-[var(--text-faint)] tabular-nums" style={{ fontFamily: '"Geist Mono", monospace' }}>
          ≈ ¥{Math.round(summary.totalCost * 7.28)}
        </span>
      </div>
      <div
        className="flex gap-3 mt-1.5 text-[11px] text-[var(--text-muted)]"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        <span>{t.usage_sessions}: {summary.sessions}</span>
        <span className="text-[var(--text-faint)]">·</span>
        <span>{t.usage_output}: {fmtTokens(summary.totalOutput)}</span>
      </div>
      {monthlyData && monthlyData.cost > 0 && (
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border)]">
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{t.usage_monthly}</span>
          <div
            className="flex items-baseline gap-2 text-[11px] tabular-nums"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            <span className="text-[var(--text-secondary)] font-medium">{fmtCost(monthlyData.cost)}</span>
            <span className="text-[var(--text-faint)]">≈ ¥{Math.round(monthlyData.cost * 7.28)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineSection({
  t,
  summary,
  animate,
}: {
  t: ReturnType<typeof useT>;
  summary: UsageSummary;
  animate: boolean;
}) {
  return (
    <div className="px-3 py-2.5">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_timeline}
      </span>
      <div className="mt-2">
        <SparklineChart buckets={summary.buckets} animate={animate} date={summary.date} />
      </div>
    </div>
  );
}

function CacheRateSection({
  t,
  summary,
  animate,
}: {
  t: ReturnType<typeof useT>;
  summary: UsageSummary;
  animate: boolean;
}) {
  // Group models into clients
  const clients: { label: string; input: number; cacheRead: number; cacheCreate: number }[] = [];
  let claudeInput = 0, claudeCacheRead = 0, claudeCacheCreate = 0;
  let codexInput = 0, codexCacheRead = 0, codexCacheCreate = 0;

  for (const m of summary.models) {
    const cc = m.cacheCreate5m + m.cacheCreate1h;
    if (m.model === "codex") {
      codexInput += m.input;
      codexCacheRead += m.cacheRead;
      codexCacheCreate += cc;
    } else {
      claudeInput += m.input;
      claudeCacheRead += m.cacheRead;
      claudeCacheCreate += cc;
    }
  }

  if (claudeInput + claudeCacheRead + claudeCacheCreate > 0) {
    clients.push({ label: "Claude", input: claudeInput, cacheRead: claudeCacheRead, cacheCreate: claudeCacheCreate });
  }
  if (codexInput + codexCacheRead + codexCacheCreate > 0) {
    clients.push({ label: "Codex", input: codexInput, cacheRead: codexCacheRead, cacheCreate: codexCacheCreate });
  }

  // Cache hit rate = cacheRead / totalInputTokens (input + cacheRead + cacheCreate)
  const overallInput = summary.totalInput;
  const overallCacheRead = summary.totalCacheRead;
  const overallCacheCreate = summary.totalCacheCreate5m + summary.totalCacheCreate1h;
  const overallTotal = overallInput + overallCacheRead + overallCacheCreate;
  if (overallTotal === 0) return null;

  const overallRate = overallCacheRead / overallTotal;

  const rows = [
    { label: t.usage_cache_rate_overall, rate: overallRate, totalInput: overallTotal, cacheRead: overallCacheRead },
    ...clients.map((c) => {
      const total = c.input + c.cacheRead + c.cacheCreate;
      return {
        label: c.label,
        rate: total > 0 ? c.cacheRead / total : 0,
        totalInput: total,
        cacheRead: c.cacheRead,
      };
    }),
  ];

  // Skip if only one client (overall == that client, redundant)
  const showRows = clients.length > 1 ? rows : [rows[0]];

  return (
    <div className="px-3 py-2.5">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_cache_rate}
      </span>
      <div className="mt-2 flex flex-col gap-1.5">
        {showRows.map((row, i) => (
          <HoverDetail
            key={row.label}
            tooltip={
              <div className="text-[10px] text-[var(--text-secondary)] tabular-nums" style={{ fontFamily: '"Geist Mono", monospace' }}>
                Cache Read: {fmtTokens(row.cacheRead)} / Total: {fmtTokens(row.totalInput)}
              </div>
            }
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--text-muted)] w-12 shrink-0 truncate">{row.label}</span>
              <Bar value={row.rate * 100} max={100} color="#eab308" animate={animate} delay={i * 60} />
              <span
                className="text-[10px] text-[var(--text-muted)] shrink-0 w-8 text-right tabular-nums"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {Math.round(row.rate * 100)}%
              </span>
            </div>
          </HoverDetail>
        ))}
      </div>
    </div>
  );
}

function ProjectsContent({
  t,
  projects,
  totalCost,
  animate,
}: {
  t: ReturnType<typeof useT>;
  projects: ProjectUsage[];
  totalCost: number;
  animate: boolean;
}) {
  if (projects.length === 0) return null;
  const maxCost = Math.max(...projects.map((p) => p.cost), 0.001);

  return (
    <div className="flex flex-col gap-1.5">
      {projects.slice(0, 6).map((p, i) => (
        <HoverDetail
          key={p.path}
          tooltip={
            <div className="text-[10px] tabular-nums" style={{ fontFamily: '"Geist Mono", monospace' }}>
              <span className="text-[var(--text-secondary)]">{fmtCost(p.cost)}</span>
              <span className="text-[var(--text-faint)] mx-1">·</span>
              <span className="text-[var(--text-muted)]">{p.calls} {t.usage_calls}</span>
              <span className="text-[var(--text-faint)] mx-1">·</span>
              <span className="text-[var(--text-muted)]">{pct(p.cost, totalCost)}</span>
            </div>
          }
        >
          <div className="flex items-center gap-2 group">
            <span
              className="text-[11px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] truncate min-w-0 flex-shrink transition-colors duration-150"
              style={{ maxWidth: "45%" }}
            >
              {p.name}
            </span>
            <Bar value={p.cost} max={maxCost} color="var(--accent)" animate={animate} delay={i * 60} />
            <span
              className="text-[10px] text-[var(--text-muted)] shrink-0 w-8 text-right tabular-nums"
              style={{ fontFamily: '"Geist Mono", monospace' }}
            >
              {pct(p.cost, totalCost)}
            </span>
          </div>
        </HoverDetail>
      ))}
    </div>
  );
}

function ModelsContent({
  t,
  models,
  animate,
}: {
  t: ReturnType<typeof useT>;
  models: ModelUsage[];
  animate: boolean;
}) {
  if (models.length === 0) return null;
  const maxCost = Math.max(...models.map((m) => m.cost), 0.001);

  const MODEL_COLORS: Record<string, string> = {
    "claude-opus-4-6": "#f97316",
    "claude-sonnet-4-6": "#a855f7",
    "claude-haiku-4-5": "#06b6d4",
    codex: "#8b5cf6",
  };

  return (
    <div className="flex flex-col gap-1.5">
      {models.map((m, i) => {
        const shortName = m.model.replace("claude-", "").replace(/-/g, " ");
        const color = MODEL_COLORS[m.model] ?? "#6b7280";
        return (
          <HoverDetail
            key={m.model}
            tooltip={
              <div className="text-[10px] tabular-nums" style={{ fontFamily: '"Geist Mono", monospace' }}>
                <div className="text-[var(--text-secondary)]">{m.model}</div>
                <div className="text-[var(--text-muted)] mt-0.5">
                  {fmtCost(m.cost)}
                  <span className="text-[var(--text-faint)] mx-1">·</span>
                  {m.calls} {t.usage_calls}
                </div>
              </div>
            }
          >
            <div className="flex items-center gap-2 group">
              <span
                className="text-[11px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] truncate min-w-0 flex-shrink transition-colors duration-150"
                style={{ maxWidth: "45%" }}
              >
                {shortName}
              </span>
              <Bar value={m.cost} max={maxCost} color={color} animate={animate} delay={i * 60} />
              <span
                className="text-[10px] text-[var(--text-muted)] shrink-0 tabular-nums"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {fmtCost(m.cost)}
              </span>
            </div>
          </HoverDetail>
        );
      })}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────

export function UsagePanel() {
  const { summary, loading, date, cachedDates, fetch: fetchUsage, heatmapData, fetchHeatmap, cloudSummary, cloudHeatmapData, fetchCloud, fetchCloudHeatmap } = useUsageStore();
  const {
    rightPanelCollapsed: collapsed,
    setRightPanelCollapsed: setCollapsed,
  } = useCanvasStore();
  const { user, deviceId } = useAuthStore();
  const t = useT();
  const quotaFetch = useQuotaStore((s) => s.fetch);
  const quotaOnCostChanged = useQuotaStore((s) => s.onCostChanged);

  const isLoggedIn = user !== null;

  // Track data version to trigger entry animations
  const [animKey, setAnimKey] = useState(0);
  const prevDateRef = useRef(date);
  const didPrefetchLocalRef = useRef(false);
  const didPrefetchCloudRef = useRef(false);

  useEffect(() => {
    if (prevDateRef.current !== date) {
      prevDateRef.current = date;
      setAnimKey((k) => k + 1);
    }
  }, [date]);

  // Init auth store once on mount
  useEffect(() => {
    useAuthStore.getState().init();
  }, []);

  // Warm the caches in the background so opening the panel doesn't kick off the heavy scan.
  useEffect(() => {
    if (didPrefetchLocalRef.current) return;
    didPrefetchLocalRef.current = true;
    const timer = window.setTimeout(() => {
      void fetchUsage();
      void fetchHeatmap();
      void quotaFetch();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [fetchUsage, fetchHeatmap, quotaFetch]);

  useEffect(() => {
    if (!isLoggedIn || didPrefetchCloudRef.current) return;
    didPrefetchCloudRef.current = true;
    const timer = window.setTimeout(() => {
      void fetchCloud();
      void fetchCloudHeatmap();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [isLoggedIn, fetchCloud, fetchCloudHeatmap]);

  // Fetch on mount / un-collapse, and poll every 60s.
  // Date changes are handled by handleDateChange / cell click directly — no need to re-fetch here.
  useEffect(() => {
    if (collapsed) return;
    void fetchUsage();
    void fetchHeatmap();
    void quotaFetch();
    if (isLoggedIn) {
      void fetchCloud();
      void fetchCloudHeatmap();
    }
    const interval = setInterval(() => {
      void fetchUsage();
      if (isLoggedIn) {
        void fetchCloud();
        void fetchCloudHeatmap();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [collapsed, isLoggedIn, fetchUsage, fetchHeatmap, quotaFetch, fetchCloud, fetchCloudHeatmap]);

  // Bridge cost changes to quota store for adaptive polling
  useEffect(() => {
    if (summary) {
      quotaOnCostChanged(summary.totalCost);
    }
  }, [summary?.totalCost]);

  const handleDateChange = useCallback(
    (dateStr: string) => {
      fetchUsage(dateStr);
      if (isLoggedIn) fetchCloud(dateStr);
    },
    [fetchUsage, fetchCloud, isLoggedIn],
  );

  // Choose data source based on login state
  // When logged in, prefer cloud (multi-device) but fall back to local maximums
  // in case backfill hasn't completed yet
  const activeSummary = (() => {
    if (isLoggedIn && cloudSummary && summary) {
      // Merge buckets: per hour, take the larger cost (cloud has multi-device, local has pre-sync)
      const localBucketMap = new Map(summary.buckets.map((b) => [b.hourStart, b]));
      const mergedBuckets = cloudSummary.buckets.map((cb) => {
        const lb = localBucketMap.get(cb.hourStart);
        if (!lb || cb.cost >= lb.cost) return cb;
        return lb;
      });
      // Add local-only buckets missing from cloud
      for (const lb of summary.buckets) {
        if (!mergedBuckets.some((b) => b.hourStart === lb.hourStart)) {
          mergedBuckets.push(lb);
        }
      }
      mergedBuckets.sort((a, b) => a.hourStart - b.hourStart);

      return {
        ...cloudSummary,
        sessions: Math.max(cloudSummary.sessions, summary.sessions),
        totalInput: Math.max(cloudSummary.totalInput, summary.totalInput),
        totalOutput: Math.max(cloudSummary.totalOutput, summary.totalOutput),
        totalCost: Math.max(cloudSummary.totalCost, summary.totalCost),
        buckets: mergedBuckets,
      };
    }
    return isLoggedIn && cloudSummary ? cloudSummary : summary;
  })();
  // Merge cloud + local heatmap: cloud wins per-day (multi-device), local fills gaps (pre-login)
  const activeHeatmap = (() => {
    if (isLoggedIn && cloudHeatmapData && heatmapData) {
      return mergeUsageHeatmaps(heatmapData, cloudHeatmapData);
    }
    return isLoggedIn && cloudHeatmapData ? cloudHeatmapData : heatmapData;
  })();

  // Compute monthly total for SummarySection
  let monthlyCost = 0;
  if (activeHeatmap) {
    const monthPrefix = date.slice(0, 7);
    for (const [d, entry] of Object.entries(activeHeatmap)) {
      if (d.startsWith(monthPrefix)) monthlyCost += entry.cost;
    }
  }
  const monthlyData = monthlyCost > 0 ? { cost: monthlyCost } : undefined;

  return (
    <div className="fixed right-0 z-40 flex" style={{ top: 44, height: "calc(100vh - 44px)" }}>
      {/* Collapsed tab */}
      <button
        className="shrink-0 flex flex-col items-center pt-3 gap-2 bg-[var(--sidebar)] overflow-hidden border-l border-[var(--border)] hover:bg-[var(--sidebar-hover)] cursor-pointer"
        style={{
          width: collapsed ? COLLAPSED_TAB_WIDTH : 0,
          transition: "width 0.2s ease, background-color 0.15s",
        }}
        onClick={() => setCollapsed(false)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[var(--text-muted)] shrink-0">
          <rect x="1.5" y="3" width="3" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="5.5" y="5" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="9.5" y="1" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span
          className="text-[9px] text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap"
          style={{ writingMode: "vertical-lr", fontFamily: '"Geist Mono", monospace' }}
        >
          {t.usage_title}
        </span>
      </button>

      {/* Expanded panel */}
      <div
        className="shrink-0 flex flex-col bg-[var(--sidebar)] overflow-hidden border-l border-[var(--border)]"
        style={{
          width: collapsed ? 0 : RIGHT_PANEL_WIDTH,
          transition: "width 0.2s ease",
        }}
      >
        {/* Header with date navigation */}
        <DateNavigator
          date={date}
          cachedDates={cachedDates}
          onDateChange={handleDateChange}
          onCollapse={() => setCollapsed(true)}
        />

        {/* Quota — fixed, not affected by date or scroll */}
        <QuotaSection />
        <div className="mx-3 h-px bg-[var(--border)]" />

        {/* Auth login/user button + insights */}
        <div className="px-3 py-1.5 shrink-0 border-b border-[var(--border)] flex items-center gap-2">
          <InsightsButton compact />
          <div className="ml-auto">
            <LoginButton />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && !activeSummary ? (
            <div className="px-3 py-4 text-[11px] text-[var(--text-faint)]">
              {t.loading}
            </div>
          ) : activeSummary ? (
            <div key={animKey} className="flex flex-col pb-3">
              <div className="usage-section-enter" style={{ animationDelay: "0ms" }}>
                <SummarySection t={t} summary={activeSummary} monthlyData={monthlyData} />
              </div>
              <div className="mx-3 h-px bg-[var(--border)]" />
              <div className="usage-section-enter" style={{ animationDelay: "40ms" }}>
                <TimelineSection t={t} summary={activeSummary} animate={true} />
              </div>
              <div className="mx-3 h-px bg-[var(--border)]" />
              <div className="usage-section-enter" style={{ animationDelay: "80ms" }}>
                <CacheRateSection t={t} summary={activeSummary} animate={true} />
              </div>
              {activeSummary.projects.length > 0 && (
                <>
                  <div className="mx-3 h-px bg-[var(--border)]" />
                  <div className="usage-section-enter" style={{ animationDelay: "120ms" }}>
                    <CollapsibleSection title={t.usage_projects}>
                      <ProjectsContent t={t} projects={activeSummary.projects} totalCost={activeSummary.totalCost} animate={true} />
                    </CollapsibleSection>
                  </div>
                </>
              )}
              {activeSummary.models.length > 0 && (
                <>
                  <div className="mx-3 h-px bg-[var(--border)]" />
                  <div className="usage-section-enter" style={{ animationDelay: "160ms" }}>
                    <CollapsibleSection title={t.usage_models}>
                      <ModelsContent t={t} models={activeSummary.models} animate={true} />
                    </CollapsibleSection>
                  </div>
                </>
              )}
              {isLoggedIn && cloudSummary && cloudSummary.devices.length > 0 && (
                <>
                  <div className="mx-3 h-px bg-[var(--border)]" />
                  <div className="usage-section-enter" style={{ animationDelay: "200ms" }}>
                    <CollapsibleSection title={t.auth_devices}>
                      <DeviceBreakdown devices={cloudSummary.devices} localDeviceId={deviceId} />
                    </CollapsibleSection>
                  </div>
                </>
              )}
              {isLoggedIn && !cloudSummary && (
                <>
                  <div className="mx-3 h-px bg-[var(--border)]" />
                  <div className="px-3 py-2 text-[10px] text-[var(--text-faint)]">{t.auth_cloud_error}</div>
                </>
              )}
              <div className="mx-3 h-px bg-[var(--border)]" />
              <div className="usage-section-enter" style={{ animationDelay: "240ms" }}>
                <TokenHeatmap animate={true} data={activeHeatmap ?? undefined} />
              </div>
            </div>
          ) : (
            <div className="px-3 py-4 text-[11px] text-[var(--text-faint)]">
              {t.usage_no_data}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
