import { useState } from "react";

interface ThinkingBlockProps {
  text: string;
  streaming: boolean;
  isDark: boolean;
}

export function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1.5">
      <button
        className="flex items-center gap-1.5 tc-label hover:text-[var(--text-secondary)] transition-colors duration-150"
        onClick={() => setExpanded((v) => !v)}
        style={{ color: "var(--text-faint)" }}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={streaming && !expanded ? "animate-pulse" : ""}>
          Thinking{streaming ? "…" : ""}
        </span>
      </button>
      {expanded && (
        <div
          className="mt-1.5 ml-3 pl-3 tc-label whitespace-pre-wrap"
          style={{
            color: "var(--text-muted)",
            borderLeft: "1px solid var(--border)",
            lineHeight: "var(--leading-relaxed)",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
