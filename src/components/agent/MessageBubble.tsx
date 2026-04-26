import { useCallback, useState } from "react";

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

function renderInlineMarkdown(text: string): React.ReactNode[] {
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
        <code
          key={key++}
          className="tc-mono"
          style={{
            background: "var(--surface)",
            color: "var(--text-primary)",
            padding: "1px 5px",
            borderRadius: 3,
            fontSize: "0.88em",
          }}
        >
          {match[1]}
        </code>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <strong key={key++} style={{ fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
          {match[2]}
        </strong>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <em key={key++} style={{ fontStyle: "italic", color: "var(--text-secondary)" }}>
          {match[3]}
        </em>,
      );
    } else if (match[4] !== undefined && match[5] !== undefined) {
      nodes.push(
        <a
          key={key++}
          href={match[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
          style={{ color: "var(--accent)" }}
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="tc-eyebrow tc-mono"
      style={{
        color: copied ? "var(--cyan)" : "var(--text-faint)",
        transition: "color var(--duration-quick) var(--ease-out-soft)",
      }}
      title="Copy code"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

export function MessageBubble({ text }: MessageBubbleProps) {
  const segments = parseCodeBlocks(text);

  return (
    <div className="tc-body">
      {segments.map((seg, i) => {
        if (seg.type === "code_block") {
          return (
            <div
              key={i}
              className="my-2.5 rounded-md overflow-hidden"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
              }}
            >
              <div
                className="flex items-center justify-between px-3 h-6"
                style={{
                  background: "var(--surface)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span className="tc-eyebrow tc-mono">
                  {seg.language || "text"}
                </span>
                <CopyButton text={seg.content} />
              </div>
              <pre
                className="tc-mono px-3 py-2.5 overflow-x-auto"
                style={{
                  fontSize: "12.5px",
                  lineHeight: "var(--leading-relaxed)",
                  color: "var(--text-secondary)",
                }}
              >
                <code>{seg.content}</code>
              </pre>
            </div>
          );
        }
        return (
          <span key={i} className="whitespace-pre-wrap">
            {renderInlineMarkdown(seg.content)}
          </span>
        );
      })}
    </div>
  );
}
