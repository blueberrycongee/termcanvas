import { useCallback } from "react";

interface MessageBubbleProps {
  text: string;
  isDark: boolean;
}

interface ParsedSegment {
  type: "text" | "code_block";
  content: string;
  language?: string;
}

function parseCodeBlocks(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: "code_block",
      language: match[1] || undefined,
      content: match[2].replace(/\n$/, ""),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments;
}

function renderInlineMarkdown(text: string, isDark: boolean): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const inline = /`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = inline.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(
        <code key={key++} className={`px-1 py-0.5 rounded text-[0.85em] font-mono ${isDark ? "bg-zinc-800 text-emerald-300" : "bg-zinc-200 text-emerald-700"}`}>
          {match[1]}
        </code>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={key++} className={`font-semibold ${isDark ? "text-zinc-50" : "text-zinc-900"}`}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(<em key={key++} className={`italic ${isDark ? "text-zinc-300" : "text-zinc-600"}`}>{match[3]}</em>);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      nodes.push(
        <a
          key={key++}
          href={match[5]}
          target="_blank"
          rel="noopener noreferrer"
          className={`underline underline-offset-2 ${isDark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-600 hover:text-emerald-500"}`}
        >
          {match[4]}
        </a>,
      );
    }
    lastIndex = inline.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function CopyButton({ text, isDark }: { text: string; isDark: boolean }) {
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`transition-colors duration-150 p-1 ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-zinc-400 hover:text-zinc-600"}`}
      title="Copy code"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="5" width="9" height="9" rx="1.5" />
        <path d="M5 11H3.5A1.5 1.5 0 012 9.5v-7A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5V5" />
      </svg>
    </button>
  );
}

export function MessageBubble({ text, isDark }: MessageBubbleProps) {
  const segments = parseCodeBlocks(text);

  return (
    <div className={`text-sm leading-relaxed font-sans ${isDark ? "text-zinc-100" : "text-zinc-900"}`}>
      {segments.map((seg, i) => {
        if (seg.type === "code_block") {
          return (
            <div key={i} className={`my-2 rounded-md overflow-hidden border ${isDark ? "bg-zinc-950 border-zinc-800" : "bg-zinc-100 border-zinc-300"}`}>
              <div className={`flex items-center justify-between px-3 py-1 border-b ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-zinc-200 border-zinc-300"}`}>
                <span className={`text-[10px] uppercase tracking-wider ${isDark ? "text-zinc-500" : "text-zinc-500"}`}>
                  {seg.language || "code"}
                </span>
                <CopyButton text={seg.content} isDark={isDark} />
              </div>
              <pre className={`px-3 py-2 overflow-x-auto text-xs font-mono leading-relaxed ${isDark ? "text-zinc-300" : "text-zinc-700"}`}>
                <code>{seg.content}</code>
              </pre>
            </div>
          );
        }
        return (
          <span key={i} className="whitespace-pre-wrap">
            {renderInlineMarkdown(seg.content, isDark)}
          </span>
        );
      })}
    </div>
  );
}
