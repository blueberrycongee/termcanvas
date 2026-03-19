import { useEffect, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUsageStore } from "../stores/usageStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useT } from "../i18n/useT";
import { DateNavigator } from "./usage/DateNavigator";
import { SparklineChart } from "./usage/SparklineChart";
import { TokenHeatmap } from "./usage/TokenHeatmap";
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

  return (
    <div
      ref={triggerRef}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && pos && createPortal(
        <div
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

// ── Section components ─────────────────────────────────────────────────

function SummarySection({ t, summary }: { t: ReturnType<typeof useT>; summary: UsageSummary }) {
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
        <SparklineChart buckets={summary.buckets} animate={animate} />
      </div>
    </div>
  );
}

function TokenBreakdown({
  t,
  summary,
  animate,
}: {
  t: ReturnType<typeof useT>;
  summary: UsageSummary;
  animate: boolean;
}) {
  const items = [
    { label: t.usage_input, value: summary.totalInput, color: "#06b6d4", cost: 0 },
    { label: t.usage_output, value: summary.totalOutput, color: "#22c55e", cost: 0 },
    { label: t.usage_cache_read, value: summary.totalCacheRead, color: "#eab308", cost: 0 },
    { label: `${t.usage_cache_create} 5m`, value: summary.totalCacheCreate5m, color: "#d946ef", cost: 0 },
    { label: `${t.usage_cache_create} 1h`, value: summary.totalCacheCreate1h, color: "#ef4444", cost: 0 },
  ];
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="px-3 py-2.5">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_tokens}
      </span>
      <div className="mt-2 flex flex-col gap-1.5">
        {items.map((item, i) => (
          <HoverDetail
            key={item.label}
            tooltip={
              <div className="text-[10px] text-[var(--text-secondary)] tabular-nums" style={{ fontFamily: '"Geist Mono", monospace' }}>
                {item.value.toLocaleString()} {t.usage_tokens_label}
              </div>
            }
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--text-muted)] w-12 shrink-0 truncate">{item.label}</span>
              <Bar value={item.value} max={max} color={item.color} animate={animate} delay={i * 60} />
              <span
                className="text-[10px] text-[var(--text-muted)] shrink-0 w-10 text-right tabular-nums"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {fmtTokens(item.value)}
              </span>
            </div>
          </HoverDetail>
        ))}
      </div>
    </div>
  );
}

function ProjectsSection({
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
    <div className="px-3 py-2.5">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_projects}
      </span>
      <div className="mt-2 flex flex-col gap-1.5">
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
              <Bar value={p.cost} max={maxCost} color="#0070f3" animate={animate} delay={i * 60} />
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
    </div>
  );
}

function ModelsSection({
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
    <div className="px-3 py-2.5">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_models}
      </span>
      <div className="mt-2 flex flex-col gap-1.5">
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
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────

export function UsagePanel() {
  const { summary, loading, date, cachedDates, fetch: fetchUsage } = useUsageStore();
  const {
    rightPanelCollapsed: collapsed,
    setRightPanelCollapsed: setCollapsed,
    rightPanelWidth: panelWidth,
    setRightPanelWidth: setPanelWidth,
  } = useCanvasStore();
  const t = useT();
  const prevWidthRef = useRef(panelWidth);

  // Track data version to trigger entry animations
  const [animKey, setAnimKey] = useState(0);
  const prevDateRef = useRef(date);

  useEffect(() => {
    if (prevDateRef.current !== date) {
      prevDateRef.current = date;
      setAnimKey((k) => k + 1);
    }
  }, [date]);

  // Fetch on mount and poll every 60s
  useEffect(() => {
    if (collapsed) return;
    fetchUsage();
    const interval = setInterval(() => fetchUsage(), 60_000);
    return () => clearInterval(interval);
  }, [collapsed, date]);

  const handleDateChange = useCallback(
    (dateStr: string) => {
      fetchUsage(dateStr);
    },
    [fetchUsage],
  );

  const COLLAPSE_THRESHOLD = 80;
  const MIN_WIDTH = 180;
  const MAX_WIDTH = 360;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();

      const handleMove = (ev: MouseEvent) => {
        const newWidth = window.innerWidth - ev.clientX;
        if (newWidth < COLLAPSE_THRESHOLD) {
          if (!useCanvasStore.getState().rightPanelCollapsed) {
            prevWidthRef.current = useCanvasStore.getState().rightPanelWidth || 240;
            setCollapsed(true);
          }
        } else {
          const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth));
          setCollapsed(false);
          setPanelWidth(clamped);
        }
      };

      const handleUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [setCollapsed, setPanelWidth],
  );

  const handleResizeDoubleClick = useCallback(() => {
    if (collapsed) {
      setCollapsed(false);
      setPanelWidth(prevWidthRef.current || 240);
    } else {
      prevWidthRef.current = panelWidth;
      setCollapsed(true);
    }
  }, [collapsed, panelWidth, setCollapsed, setPanelWidth]);

  return (
    <div className="fixed right-0 z-40 flex" style={{ top: 44 }}>
      {/* Resize handle */}
      <div
        className="cursor-col-resize shrink-0 hover:bg-[var(--accent)] transition-colors duration-150"
        style={{
          width: collapsed ? 6 : 4,
          marginRight: collapsed ? 4 : 0,
          height: "calc(100vh - 44px)",
        }}
        onMouseDown={handleResizeStart}
        onDoubleClick={handleResizeDoubleClick}
      />

      <div
        className="flex flex-col bg-[var(--bg)] overflow-hidden border-l border-[var(--border)]"
        style={{
          width: collapsed ? 0 : panelWidth,
          height: "calc(100vh - 44px)",
          transition: collapsed ? "width 0.2s ease" : undefined,
        }}
      >
        {/* Header with date navigation */}
        <DateNavigator
          date={date}
          cachedDates={cachedDates}
          onDateChange={handleDateChange}
        />

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && !summary ? (
            <div className="px-3 py-4 text-[11px] text-[var(--text-faint)]">
              {t.loading}
            </div>
          ) : summary ? (
            <div key={animKey} className="flex flex-col pb-3">
              <div className="usage-section-enter" style={{ animationDelay: "0ms" }}>
                <SummarySection t={t} summary={summary} />
              </div>
              <div className="mx-3 h-px bg-[var(--border)]" />
              <div className="usage-section-enter" style={{ animationDelay: "50ms" }}>
                <TimelineSection t={t} summary={summary} animate={true} />
              </div>
              <div className="mx-3 h-px bg-[var(--border)]" />
              <div className="usage-section-enter" style={{ animationDelay: "100ms" }}>
                <TokenBreakdown t={t} summary={summary} animate={true} />
              </div>
              {summary.projects.length > 0 && <div className="mx-3 h-px bg-[var(--border)]" />}
              <div className="usage-section-enter" style={{ animationDelay: "150ms" }}>
                <ProjectsSection t={t} projects={summary.projects} totalCost={summary.totalCost} animate={true} />
              </div>
              {summary.models.length > 0 && <div className="mx-3 h-px bg-[var(--border)]" />}
              <div className="usage-section-enter" style={{ animationDelay: "200ms" }}>
                <ModelsSection t={t} models={summary.models} animate={true} />
              </div>
              <div className="mx-3 h-px bg-[var(--border)]" />
              <div className="usage-section-enter" style={{ animationDelay: "250ms" }}>
                <TokenHeatmap animate={true} />
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
