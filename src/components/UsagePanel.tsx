import { useEffect, useCallback, useRef } from "react";
import { useUsageStore } from "../stores/usageStore";
import { useCanvasStore } from "../stores/canvasStore";
import { useT } from "../i18n/useT";
import type { UsageBucket, UsageSummary, ProjectUsage, ModelUsage } from "../types";

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

// ── Bar component ──────────────────────────────────────────────────────

function Bar({ value, max, color = "var(--accent)" }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 rounded-full bg-[var(--border)] flex-1 min-w-0">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${w}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Sparkline ──────────────────────────────────────────────────────────

function Sparkline({ buckets }: { buckets: UsageBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.cost), 0.001);
  const now = new Date();
  const currentHour = now.getHours();

  return (
    <div className="flex items-end gap-px h-8">
      {buckets.map((b, i) => {
        const h = max > 0 ? Math.max(0, (b.cost / max) * 100) : 0;
        const isFuture = b.hourStart > currentHour;
        const isActive = b.calls > 0;
        return (
          <div
            key={i}
            className="flex-1 min-w-0 rounded-t-sm transition-all duration-300"
            style={{
              height: `${isFuture ? 4 : Math.max(isActive ? 12 : 4, h)}%`,
              backgroundColor: isFuture
                ? "var(--border)"
                : isActive
                  ? "#0070f3"
                  : "var(--border)",
              opacity: isFuture ? 0.3 : isActive ? 0.5 + (h / 100) * 0.5 : 0.3,
            }}
            title={`${b.label}\n${fmtCost(b.cost)} · ${b.calls} calls`}
          />
        );
      })}
    </div>
  );
}

// ── Section components ─────────────────────────────────────────────────

function SummarySection({ t, summary }: { t: ReturnType<typeof useT>; summary: UsageSummary }) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[20px] font-semibold text-[var(--text-primary)]" style={{ fontFamily: '"Geist Mono", monospace' }}>
          {fmtCost(summary.totalCost)}
        </span>
        <span className="text-[11px] text-[var(--text-faint)]">
          ≈ ¥{Math.round(summary.totalCost * 7.28)}
        </span>
      </div>
      <div className="flex gap-3 mt-1 text-[11px] text-[var(--text-muted)]" style={{ fontFamily: '"Geist Mono", monospace' }}>
        <span>{t.usage_sessions}: {summary.sessions}</span>
        <span>{t.usage_output}: {fmtTokens(summary.totalOutput)}</span>
      </div>
    </div>
  );
}

function TimelineSection({ t, buckets }: { t: ReturnType<typeof useT>; buckets: UsageBucket[] }) {
  return (
    <div className="px-3 py-2">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_timeline}
      </span>
      <div className="mt-1.5">
        <Sparkline buckets={buckets} />
        <div className="flex justify-between mt-0.5 text-[9px] text-[var(--text-faint)]" style={{ fontFamily: '"Geist Mono", monospace' }}>
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>
    </div>
  );
}

function ProjectsSection({ t, projects }: { t: ReturnType<typeof useT>; projects: ProjectUsage[] }) {
  if (projects.length === 0) return null;
  const maxCost = Math.max(...projects.map((p) => p.cost), 0.001);
  const totalCost = projects.reduce((s, p) => s + p.cost, 0);

  return (
    <div className="px-3 py-2">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_projects}
      </span>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {projects.slice(0, 6).map((p) => (
          <div key={p.path} className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-secondary)] truncate min-w-0 flex-shrink" style={{ maxWidth: "45%" }}>
              {p.name}
            </span>
            <Bar value={p.cost} max={maxCost} color="#0070f3" />
            <span className="text-[10px] text-[var(--text-muted)] shrink-0 w-8 text-right" style={{ fontFamily: '"Geist Mono", monospace' }}>
              {pct(p.cost, totalCost)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModelsSection({ t, models }: { t: ReturnType<typeof useT>; models: ModelUsage[] }) {
  if (models.length === 0) return null;
  const maxCost = Math.max(...models.map((m) => m.cost), 0.001);

  const MODEL_COLORS: Record<string, string> = {
    "claude-opus-4-6": "#f97316",
    "claude-sonnet-4-6": "#a855f7",
    "claude-haiku-4-5": "#06b6d4",
    codex: "#8b5cf6",
  };

  return (
    <div className="px-3 py-2">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_models}
      </span>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {models.map((m) => {
          const shortName = m.model.replace("claude-", "").replace(/-/g, " ");
          const color = MODEL_COLORS[m.model] ?? "#6b7280";
          return (
            <div key={m.model} className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-secondary)] truncate min-w-0 flex-shrink" style={{ maxWidth: "45%" }}>
                {shortName}
              </span>
              <Bar value={m.cost} max={maxCost} color={color} />
              <span className="text-[10px] text-[var(--text-muted)] shrink-0" style={{ fontFamily: '"Geist Mono", monospace' }}>
                {fmtCost(m.cost)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TokenBreakdown({ t, summary }: { t: ReturnType<typeof useT>; summary: UsageSummary }) {
  const items = [
    { label: t.usage_input, value: summary.totalInput, color: "#06b6d4" },
    { label: t.usage_output, value: summary.totalOutput, color: "#22c55e" },
    { label: t.usage_cache_read, value: summary.totalCacheRead, color: "#eab308" },
    { label: `${t.usage_cache_create} 5m`, value: summary.totalCacheCreate5m, color: "#d946ef" },
    { label: `${t.usage_cache_create} 1h`, value: summary.totalCacheCreate1h, color: "#ef4444" },
  ];
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="px-3 py-2">
      <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
        {t.usage_tokens}
      </span>
      <div className="mt-1.5 flex flex-col gap-1">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] w-12 shrink-0 truncate">{item.label}</span>
            <Bar value={item.value} max={max} color={item.color} />
            <span className="text-[10px] text-[var(--text-muted)] shrink-0 w-10 text-right" style={{ fontFamily: '"Geist Mono", monospace' }}>
              {fmtTokens(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────

export function UsagePanel() {
  const { summary, loading, date, fetch: fetchUsage } = useUsageStore();
  const {
    rightPanelCollapsed: collapsed,
    setRightPanelCollapsed: setCollapsed,
    rightPanelWidth: panelWidth,
    setRightPanelWidth: setPanelWidth,
  } = useCanvasStore();
  const t = useT();
  const prevWidthRef = useRef(panelWidth);

  // Fetch on mount and poll every 60s
  useEffect(() => {
    if (collapsed) return;
    fetchUsage();
    const interval = setInterval(() => fetchUsage(), 60_000);
    return () => clearInterval(interval);
  }, [collapsed, date]);

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
        {/* Header */}
        <div className="px-3 py-2 shrink-0">
          <span
            className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider px-1"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {t.usage_title}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && !summary ? (
            <div className="px-3 py-4 text-[11px] text-[var(--text-faint)]">
              {t.loading}
            </div>
          ) : summary ? (
            <div className="flex flex-col divide-y divide-[var(--border)]">
              <SummarySection t={t} summary={summary} />
              <TimelineSection t={t} buckets={summary.buckets} />
              <TokenBreakdown t={t} summary={summary} />
              <ProjectsSection t={t} projects={summary.projects} />
              <ModelsSection t={t} models={summary.models} />
            </div>
          ) : (
            <div className="px-3 py-4 text-[11px] text-[var(--text-faint)]">
              {t.usage_no_data}
            </div>
          )}
        </div>

        {/* Footer: date */}
        <div className="px-3 py-1.5 shrink-0 border-t border-[var(--border)]">
          <span className="text-[10px] text-[var(--text-faint)]" style={{ fontFamily: '"Geist Mono", monospace' }}>
            {date}
          </span>
        </div>
      </div>
    </div>
  );
}
