import { useState } from "react";
import { DismissButton } from "./DismissButton";

const COLLAPSE_THRESHOLD = 50;

interface Props {
  content: string;
  onDismiss: () => void;
}

export function DiffOverlay({ content, onDismiss }: Props) {
  const lines = content.split("\n");
  const shouldCollapse = lines.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!shouldCollapse);

  const fileName = lines.find((l) => l.startsWith("--- "))?.replace("--- a/", "") ?? "diff";

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)]/90 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5">
        {shouldCollapse && (
          <button
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] pointer-events-auto"
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={() => setExpanded((v) => !v)}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            >
              <path d="M2 1L6 4L2 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <span className="text-[11px] text-[var(--text-primary)] flex-1 truncate" style={{ fontFamily: '"Geist Mono", monospace' }}>
          {fileName}
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">{lines.length} lines</span>
        <DismissButton onClick={onDismiss} />
      </div>
      {expanded && (
        <pre className="px-3 py-1 text-[11px] leading-relaxed overflow-x-auto" style={{ fontFamily: '"Geist Mono", monospace' }}>
          {lines.map((line, i) => {
            let color = "var(--text-secondary)";
            let bg = "transparent";
            if (line.startsWith("+") && !line.startsWith("+++")) { color = "var(--cyan)"; bg = "var(--cyan-bg, rgba(80, 227, 194, 0.06))"; }
            else if (line.startsWith("-") && !line.startsWith("---")) { color = "var(--red)"; bg = "var(--red-bg, rgba(238, 0, 0, 0.06))"; }
            else if (line.startsWith("@@")) { color = "var(--accent)"; }
            else if (line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) { color = "var(--text-muted)"; }
            return <div key={i} style={{ color, backgroundColor: bg }}>{line || " "}</div>;
          })}
        </pre>
      )}
    </div>
  );
}
