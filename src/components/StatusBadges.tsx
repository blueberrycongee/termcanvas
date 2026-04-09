import type { StatusSummary } from "./sessionPanelModel";

const BADGE_COLORS: { key: keyof StatusSummary; color: string }[] = [
  { key: "attention", color: "#ef4444" },
  { key: "running", color: "#f59e0b" },
  { key: "freshDone", color: "#3b82f6" },
  { key: "done", color: "#6b7280" },
  { key: "idle", color: "#94a3b8" },
];

export function StatusBadges({ summary }: { summary: StatusSummary }) {
  return (
    <div className="flex items-center gap-1.5">
      {BADGE_COLORS.map(
        ({ key, color }) =>
          summary[key] > 0 && (
            <span key={key} className="flex items-center gap-0.5">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: color }}
              />
              <span
                className="text-[9px] tabular-nums text-[var(--text-muted)]"
                style={{ fontFamily: '"Geist Mono", monospace' }}
              >
                {summary[key]}
              </span>
            </span>
          ),
      )}
    </div>
  );
}
