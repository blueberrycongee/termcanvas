import { useState } from "react";
import { useT } from "../../i18n/useT";

interface ThinkingBlockProps {
  text: string;
  streaming: boolean;
  isDark: boolean;
}

export function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-0.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          aria-hidden
          className="shrink-0"
          style={{
            color: "var(--text-faint)",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform var(--duration-quick) var(--ease-out-soft)",
          }}
        >
          <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          className="italic"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
            opacity: streaming && !expanded ? 0.7 : 1,
            transition: "opacity var(--duration-quick) var(--ease-out-soft)",
          }}
        >
          {streaming ? t["agent.thinking.streaming"] : t["agent.thinking.label"]}
        </span>
      </button>
      {expanded && (
        <div
          className="mt-1 italic whitespace-pre-wrap break-words tc-enter-fade-quick"
          style={{
            paddingLeft: "18px",
            fontSize: "var(--text-xs)",
            lineHeight: "var(--leading-normal)",
            color: "var(--text-muted)",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
