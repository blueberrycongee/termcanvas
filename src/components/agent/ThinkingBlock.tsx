import { useState } from "react";

interface ThinkingBlockProps {
  text: string;
  streaming: boolean;
}

export function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1">
      <button
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors duration-150"
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
        <div className="mt-1 pl-4 text-xs text-zinc-500 italic whitespace-pre-wrap leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}
