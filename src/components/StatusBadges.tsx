import type { StatusSummary } from "./sessionPanelModel";

const BADGE_COLORS: { key: keyof StatusSummary; color: string }[] = [
  { key: "attention", color: "var(--red)" },
  { key: "running", color: "var(--amber)" },
  { key: "freshDone", color: "var(--accent)" },
  { key: "done", color: "var(--text-muted)" },
  { key: "idle", color: "var(--text-faint)" },
];

export function StatusBadges({ summary }: { summary: StatusSummary }) {
  return (
    <div className="flex items-center gap-1.5">
      {BADGE_COLORS.map(
        ({ key, color }) =>
          summary[key] > 0 && (
            <span key={key} className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: color }}
              />
              <span
                className="tc-caption tc-num tc-mono"
                style={{ color: "var(--text-muted)" }}
              >
                {summary[key]}
              </span>
            </span>
          ),
      )}
    </div>
  );
}
