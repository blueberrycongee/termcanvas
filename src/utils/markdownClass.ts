import { marked } from "marked";

export const markdownClassName =
  "prose prose-sm prose-invert max-w-none text-[length:var(--text-md)] leading-relaxed text-[var(--text-primary)] " +
  "[&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 " +
  "[&_h2]:text-[length:var(--text-md)] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_h3]:text-[length:var(--text-base)] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 " +
  "[&_p]:my-1.5 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5 " +
  "[&_a]:text-[var(--accent)] [&_a]:cursor-pointer " +
  "[&_code]:text-[var(--text-primary)] [&_code]:bg-[var(--surface)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[length:var(--text-xs)] [&_code]:break-words " +
  "[&_pre]:bg-[var(--surface)] [&_pre]:rounded-md [&_pre]:p-2.5 [&_pre]:text-[length:var(--text-xs)] [&_pre]:overflow-x-auto [&_pre]:min-w-0 " +
  "[&_p]:break-words [&_li]:break-words [&_h1]:break-words [&_h2]:break-words [&_h3]:break-words [&_a]:break-all " +
  "[&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full [&_table]:min-w-0 " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-hover)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-muted)] " +
  "[&_hr]:border-[var(--border)]";

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false, breaks: true }) as string;
}
