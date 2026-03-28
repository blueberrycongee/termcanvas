import { useCallback, useMemo, useState } from "react";
import { DismissButton } from "./DismissButton";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import diff from "highlight.js/lib/languages/diff";
import markdown from "highlight.js/lib/languages/markdown";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("py", python);
hljs.registerLanguage("sh", bash);

interface Props {
  content: string;
  language?: string;
  status: "pending" | "complete";
  onDismiss: () => void;
}

export function CodeBlockOverlay({ content, language, status, onDismiss }: Props) {
  const [copied, setCopied] = useState(false);

  const highlighted = useMemo(() => {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value;
    }
    return hljs.highlightAuto(content).value;
  }, [content, language]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)]/90 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1">
        {language && (
          <span
            className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]"
            style={{ fontFamily: '"Geist Mono", monospace' }}
          >
            {language}
          </span>
        )}
        <span className="flex-1" />
        <button
          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] pointer-events-auto px-1.5 py-0.5 rounded hover:bg-[var(--border)]/50"
          onClick={handleCopy}
          style={{ fontFamily: '"Geist Mono", monospace' }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <DismissButton onClick={onDismiss} />
      </div>
      <pre
        className="px-3 pb-2 text-[11px] leading-relaxed overflow-x-auto"
        style={{ fontFamily: '"Geist Mono", monospace' }}
      >
        <code
          className="hljs"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
      {status === "pending" && (
        <div className="h-0.5 bg-[var(--accent)]/30 animate-pulse" />
      )}
    </div>
  );
}
