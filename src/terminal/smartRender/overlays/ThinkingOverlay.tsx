import { useState, useEffect } from "react";
import { DismissButton } from "./DismissButton";

interface Props {
  content: string;
  status: "pending" | "complete";
  onDismiss: () => void;
}

export function ThinkingOverlay({ content, status, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(status === "pending");
  const lines = content.split("\n").filter(Boolean);
  const firstLine = lines[0] ?? "";

  useEffect(() => {
    if (status === "complete") setExpanded(false);
  }, [status]);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)]/90">
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 pointer-events-auto"
        aria-label={expanded ? "Collapse thinking" : "Expand thinking"}
        onClick={() => setExpanded((v) => !v)}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          className={`shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M2 1L6 4L2 7" stroke="var(--text-muted)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          className="text-[11px] italic text-[var(--text-muted)] truncate flex-1 text-left"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {expanded ? "Thinking..." : `${firstLine.slice(0, 60)}${lines.length > 1 ? ` ...${lines.length} lines` : ""}`}
        </span>
        {status === "pending" && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />}
        <DismissButton onClick={onDismiss} stopPropagation />
      </button>
      {expanded && (
        <pre
          className="px-3 pb-2 text-[11px] leading-relaxed italic text-[var(--text-muted)] whitespace-pre-wrap"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {content}
        </pre>
      )}
    </div>
  );
}
