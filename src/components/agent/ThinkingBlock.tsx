import { useState } from "react";

interface ThinkingBlockProps {
  text: string;
  streaming: boolean;
  isDark: boolean;
}

export function ThinkingBlock({ text, streaming, isDark }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1">
      <button
        className={`flex items-center gap-1.5 text-xs transition-colors duration-150 ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-zinc-400 hover:text-zinc-600"}`}
        onClick={() => setExpanded((v) => !v)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M3 1.5L7 5L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className={streaming && !expanded ? "animate-pulse" : ""}>
          Thinking…
        </span>
      </button>
      {expanded && (
        <div className={`mt-1 pl-4 text-xs italic whitespace-pre-wrap leading-relaxed ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
          {text}
        </div>
      )}
    </div>
  );
}
