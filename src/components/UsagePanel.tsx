import { useEffect, useCallback, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useUsageStore } from "../stores/usageStore";
import { useCanvasStore } from "../stores/canvasStore";
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
import { useCodexQuotaStore } from "../stores/codexQuotaStore";
import type {
  UsageSummary,
  CloudUsageSummary,
  ProjectUsage,
  ModelUsage,
} from "../types";
import type { HeatmapEntry } from "../stores/usageStore";

export function fmtCost(c: number): string {
  return c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(3)}`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function pct(value: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

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
          <div className="rounded-md px-2.5 py-1.5 border border-[var(--border)] bg-[var(--surface)] shadow-lg">
            {tooltip}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

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
        <span className="tc-eyebrow">{title}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function SummarySection({
  t,
  summary,
  monthlyData,
}: {
  t: ReturnType<typeof useT>;
  summary: UsageSummary;
  monthlyData?: { cost: number; dailyAvg?: number };
}) {
  const animatedCost = useAnimatedNumber(summary.totalCost);

  return (
    <div className="px-3 pt-2.5 pb-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tc-stat-lg">{fmtCost(animatedCost)}</span>
        <span className="tc-caption tc-mono tc-num">
          ≈ ¥{Math.round(summary.totalCost * 7.28)}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-2 tc-caption tc-mono tc-num">
        <span>
          {summary.sessions} {t.usage_sessions}
        </span>
        <span className="text-[var(--text-faint)]">·</span>
        <span>{fmtTokens(summary.totalOutput)} {t.usage_output}</span>
      </div>
      {monthlyData && monthlyData.cost > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-[var(--border)] flex items-center justify-between">
          <span className="tc-eyebrow">{t.usage_monthly}</span>
          <div className="flex items-baseline gap-2 tc-caption tc-mono tc-num">
            <span className="text-[var(--text-secondary)] font-medium">
              {fmtCost(monthlyData.cost)}
            </span>
            {monthlyData.dailyAvg !== undefined && monthlyData.dailyAvg > 0 && (
              <>
                <span className="text-[var(--text-faint)]">·</span>
                <span className="text-[var(--text-faint)]">
                  ∅ {fmtCost(monthlyData.dailyAvg)}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TimelineSection({
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
      <span className="tc-eyebrow">{t.usage_timeline}</span>
      <div className="mt-2">
        <SparklineChart buckets={summary.buckets} animate={animate} date={summary.date} />
      </div>
    </div>
  );
}

export function CacheRateSection({
  t,
  summary,
  animate,
  bare = false,
}: {
  t: ReturnType<typeof useT>;
  summary: UsageSummary;
  animate: boolean;
  /**
   * When true, skip the outer px-3/py-2.5 wrapper and the internal
   * title span. Used by the full-screen overlay where SectionCard
   * already owns both the title bar and the content padding.
   */
  bare?: boolean;
}) {
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

  const showRows = clients.length > 1 ? rows : [rows[0]];

  const body = (
    <div className="flex flex-col gap-1.5">
      {showRows.map((row, i) => (
        <HoverDetail
          key={row.label}
          tooltip={
            <div className="text-[10px] text-[var(--text-secondary)] tc-mono tc-num">
              Cache Read: {fmtTokens(row.cacheRead)} / Total: {fmtTokens(row.totalInput)}
            </div>
          }
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] w-12 shrink-0 truncate">{row.label}</span>
            <Bar value={row.rate * 100} max={100} color="var(--amber)" animate={animate} delay={i * 60} />
            <span className="text-[10px] text-[var(--text-muted)] shrink-0 w-8 text-right tc-mono tc-num">
              {Math.round(row.rate * 100)}%
            </span>
          </div>
        </HoverDetail>
      ))}
    </div>
  );

  if (bare) return body;

  return (
    <div className="px-3 py-2.5">
      <span className="tc-eyebrow">{t.usage_cache_rate}</span>
      <div className="mt-2">{body}</div>
    </div>
  );
}

export function ProjectsContent({
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
            <div className="text-[10px] tc-mono tc-num">
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
            <span className="text-[10px] text-[var(--text-muted)] shrink-0 w-8 text-right tc-mono tc-num">
              {pct(p.cost, totalCost)}
            </span>
          </div>
        </HoverDetail>
      ))}
    </div>
  );
}

export function ModelsContent({
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

  // Per-model hues. Distinct from the semantic token palette on
  // purpose — these are *categorical* colors (one hue per family),
  // not status colors. Centralised here so the overlay and sidebar
  // agree, and so theme tweaks can adjust all of them in one spot.
  const MODEL_COLORS: Record<string, string> = {
    "claude-opus-4-6": "#f97316",
    "claude-sonnet-4-6": "var(--purple)",
    "claude-haiku-4-5": "var(--cyan)",
    codex: "#8b5cf6",
  };

  return (
    <div className="flex flex-col gap-1.5">
      {models.map((m, i) => {
        const shortName = m.model.replace("claude-", "").replace(/-/g, " ");
        const color = MODEL_COLORS[m.model] ?? "var(--text-muted)";
        return (
          <HoverDetail
            key={m.model}
            tooltip={
              <div className="text-[10px] tc-mono tc-num">
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
              <span className="text-[10px] text-[var(--text-muted)] shrink-0 tc-mono tc-num">
                {fmtCost(m.cost)}
              </span>
            </div>
          </HoverDetail>
        );
      })}
    </div>
  );
}

/**
 * Merge local ingest + cloud-sync usage summaries into the best
 * "what happened today" view. Both the sidebar UsagePanel and the
 * full-screen UsageOverlay use this — pulling it out keeps the two
 * renderers in exact agreement about which number wins when the two
 * data sources disagree (the pricier of the two, to avoid
 * undercounting during cloud lag).
 */
export function deriveActiveUsage({
  isLoggedIn,
  summary,
  cloudSummary,
  heatmapData,
  cloudHeatmapData,
}: {
  isLoggedIn: boolean;
  summary: UsageSummary | null;
  cloudSummary: CloudUsageSummary | null;
  heatmapData: Record<string, HeatmapEntry> | null;
  cloudHeatmapData: Record<string, HeatmapEntry> | null;
}): {
  activeSummary: UsageSummary | null;
  activeHeatmap: Record<string, HeatmapEntry> | null;
} {
  let activeSummary: UsageSummary | null;
  if (isLoggedIn && cloudSummary && summary) {
    const localBucketMap = new Map(summary.buckets.map((b) => [b.hourStart, b]));
    const mergedBuckets = cloudSummary.buckets.map((cb) => {
      const lb = localBucketMap.get(cb.hourStart);
      if (!lb || cb.cost >= lb.cost) return cb;
      return lb;
    });
    for (const lb of summary.buckets) {
      if (!mergedBuckets.some((b) => b.hourStart === lb.hourStart)) {
        mergedBuckets.push(lb);
      }
    }
    mergedBuckets.sort((a, b) => a.hourStart - b.hourStart);

    activeSummary = {
      ...cloudSummary,
      sessions: Math.max(cloudSummary.sessions, summary.sessions),
      totalInput: Math.max(cloudSummary.totalInput, summary.totalInput),
      totalOutput: Math.max(cloudSummary.totalOutput, summary.totalOutput),
      totalCost: Math.max(cloudSummary.totalCost, summary.totalCost),
      buckets: mergedBuckets,
    };
  } else {
    activeSummary = isLoggedIn && cloudSummary ? cloudSummary : summary;
  }

  let activeHeatmap: Record<string, HeatmapEntry> | null;
  if (isLoggedIn && cloudHeatmapData && heatmapData) {
    activeHeatmap = mergeUsageHeatmaps(heatmapData, cloudHeatmapData);
  } else {
    activeHeatmap = isLoggedIn && cloudHeatmapData ? cloudHeatmapData : heatmapData;
  }

  return { activeSummary, activeHeatmap };
}

export function UsagePanel() {
  const { summary, loading, date, cachedDates, fetch: fetchUsage, heatmapData, fetchHeatmap, cloudSummary, cloudHeatmapData, fetchCloud, fetchCloudHeatmap } = useUsageStore();
  const { user, deviceId } = useAuthStore();
  const t = useT();
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

  useEffect(() => {
    useAuthStore.getState().init();
  }, []);

  const lastFetchRef = useRef(0);

  // Fetch on mount, skip if data was fetched within last 30s (tab switch debounce).
  useEffect(() => {
    if (summary && Date.now() - lastFetchRef.current < 30_000) return;
    lastFetchRef.current = Date.now();
    void fetchUsage();
    void quotaFetch();
    void codexQuotaFetch();
    if (isLoggedIn) {
      void fetchCloud();
    }
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
  }, [isLoggedIn, fetchUsage, quotaFetch, codexQuotaFetch, fetchCloud, fetchCloudHeatmap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (summary) {
      quotaOnCostChanged(summary.totalCost);
    }
  }, [summary?.totalCost, quotaOnCostChanged]);

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

  let monthlyCost = 0;
  let daysWithData = 0;
  if (activeHeatmap) {
    const monthPrefix = date.slice(0, 7);
    for (const [d, entry] of Object.entries(activeHeatmap)) {
      if (!d.startsWith(monthPrefix)) continue;
      if (entry.cost > 0) {
        monthlyCost += entry.cost;
        daysWithData += 1;
      }
    }
  }
  const monthlyData =
    monthlyCost > 0
      ? {
          cost: monthlyCost,
          dailyAvg: daysWithData > 0 ? monthlyCost / daysWithData : 0,
        }
      : undefined;

  return (
    <div className="flex flex-col h-full">
      <DateNavigator
        date={date}
        cachedDates={cachedDates}
        onDateChange={handleDateChange}
        onCollapse={() => useCanvasStore.getState().setRightPanelCollapsed(true)}
      />

      <QuotaSection />
      <div className="mx-3 h-px bg-[var(--border)]" />

      <div className="px-3 py-1.5 shrink-0 border-b border-[var(--border)] flex items-center gap-2">
        <InsightsButton compact />
        <div className="ml-auto">
          <LoginButton />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && !activeSummary ? (
          <div className="px-3 py-4 tc-caption">{t.loading}</div>
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
              {summary && <CacheRateSection t={t} summary={summary} animate={true} />}
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
                <div className="px-3 py-2 tc-caption">{t.auth_cloud_error}</div>
              </>
            )}
            <div className="mx-3 h-px bg-[var(--border)]" />
            <div className="usage-section-enter" style={{ animationDelay: "240ms" }}>
              <TokenHeatmap
                animate={true}
                data={activeHeatmap ?? undefined}
                onVisible={() => {
                  void fetchHeatmap();
                  if (isLoggedIn) {
                    void fetchCloudHeatmap();
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <div className="px-3 py-4 tc-caption">{t.usage_no_data}</div>
        )}
      </div>
    </div>
  );
}
