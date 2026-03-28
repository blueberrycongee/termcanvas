import { useState } from "react";
import { DismissButton } from "./DismissButton";

interface Props {
  content: string;
  toolName?: string;
  status: "pending" | "complete";
  onDismiss: () => void;
}

export function ToolCallOverlay({ content, toolName, status, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n").filter(Boolean);
  const summary = lines[0]?.slice(0, 80) ?? "";

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)]/90">
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 pointer-events-auto"
        aria-label={expanded ? "Collapse tool call" : "Expand tool call"}
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
        {toolName && (
          <span
            className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--accent)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {toolName}
          </span>
        )}
        <span
          className="text-[11px] text-[var(--text-secondary)] truncate flex-1 text-left"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {summary}
        </span>
        {status === "pending" && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />}
        <DismissButton onClick={onDismiss} stopPropagation />
      </button>
      {expanded && (
        <pre
          className="px-3 pb-2 text-[11px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap"
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {content}
        </pre>
      )}
    </div>
  );
}
