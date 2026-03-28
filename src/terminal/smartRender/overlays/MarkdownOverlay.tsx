import { useMemo } from "react";
import { marked } from "marked";
import { DismissButton } from "./DismissButton";

interface Props {
  content: string;
  onDismiss: () => void;
}

export function MarkdownOverlay({ content, onDismiss }: Props) {
  const html = useMemo(
    () => marked.parse(content, { async: false }) as string,
    [content],
  );

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)]/90 px-3 py-2">
      <div className="flex items-center justify-end mb-1">
        <DismissButton onClick={onDismiss} />
      </div>
      <div
        className="prose prose-sm max-w-none text-[11px] leading-relaxed text-[var(--text-secondary)] [&_h1]:text-[15px] [&_h2]:text-[14px] [&_h3]:text-[13px] [&_h1]:text-[var(--text-primary)] [&_h2]:text-[var(--text-primary)] [&_h3]:text-[var(--text-primary)] [&_code]:text-[var(--accent)] [&_code]:bg-[var(--surface)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[11px] [&_a]:text-[var(--accent)] [&_strong]:text-[var(--text-primary)] [&_li]:text-[var(--text-secondary)]"
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ fontFamily: '"Geist Mono", monospace' }}
      />
    </div>
  );
}
