import { Marked, marked } from "marked";
import DOMPurify from "dompurify";

const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|xxx|urn|tc-attachment):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
const PIN_HTML_CSP = [
  "default-src 'none'",
  "img-src data: blob: http: https: tc-attachment:",
  "media-src data: blob: http: https: tc-attachment:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
const HTML_DOCUMENT_RE =
  /^\s*(?:<!doctype\s+html[^>]*>|<html[\s>]|<head[\s>]|<body[\s>])/i;

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP,
  });
}

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
  "[&_hr]:border-[var(--border)] " +
  "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md [&_img]:border [&_img]:border-[var(--border)] [&_img]:my-2";

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, breaks: true }) as string;
  return sanitizeHtml(html);
}

export function renderMarkdownWithAttachments(
  text: string,
  attachmentsUrl: string | undefined,
): string {
  const baseUrl = normalizeAttachmentsUrl(attachmentsUrl);
  const m = new Marked({
    async: false,
    breaks: true,
    renderer: {
      image({ href, title, text: alt }) {
        const resolved = resolveAttachmentHref(href, baseUrl);
        const safeHref = escapeAttr(resolved);
        const safeAlt = escapeAttr(alt ?? "");
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        const img = `<img src="${safeHref}" alt="${safeAlt}"${titleAttr} loading="lazy" />`;
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${img}</a>`;
      },
    },
  });
  const html = sanitizeHtml(m.parse(text) as string);
  return rewriteRelativeAttachmentMedia(html, baseUrl);
}

export function isHtmlDocument(text: string): boolean {
  return HTML_DOCUMENT_RE.test(text);
}

export function renderHtmlDocumentWithAttachments(
  text: string,
  attachmentsUrl: string | undefined,
): string {
  const parsed = parseHtmlDocument(text);
  if (!parsed) {
    return `<!doctype html><html><head>${pinHtmlCspMeta()}</head><body>${sanitizeHtml(
      text,
    )}</body></html>`;
  }

  parsed.querySelectorAll("base").forEach((el) => el.remove());
  const head = parsed.head;
  head
    .querySelectorAll("meta[http-equiv]")
    .forEach((el) => {
      if (
        el
          .getAttribute("http-equiv")
          ?.toLowerCase()
          .trim() === "content-security-policy"
      ) {
        el.remove();
      }
    });
  head.insertAdjacentHTML("afterbegin", pinHtmlCspMeta());
  rewriteRelativeAttachmentMediaInRoot(
    parsed,
    normalizeAttachmentsUrl(attachmentsUrl),
  );

  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

function normalizeAttachmentsUrl(attachmentsUrl: string | undefined): string | null {
  return attachmentsUrl ? attachmentsUrl.replace(/\/$/, "") : null;
}

function resolveAttachmentHref(href: string, baseUrl: string | null): string {
  if (!baseUrl) return href;
  if (!href.startsWith("./")) return href;
  const segments = href.slice(2).split("/");
  const basename = segments[segments.length - 1];
  if (!basename) return href;
  return `${baseUrl}/${encodeURIComponent(basename)}`;
}

function rewriteRelativeAttachmentMedia(
  html: string,
  baseUrl: string | null,
): string {
  if (!baseUrl) return html;
  const doc = getDocument();
  if (!doc) return html;
  const template = doc.createElement("template");
  template.innerHTML = html;
  rewriteRelativeAttachmentMediaInRoot(template.content, baseUrl);
  return template.innerHTML;
}

function rewriteRelativeAttachmentMediaInRoot(
  root: ParentNode,
  baseUrl: string | null,
): void {
  if (!baseUrl) return;
  root.querySelectorAll("img[src], source[src], video[poster]").forEach((node) => {
    const el = node as Element;
    for (const attr of ["src", "poster"]) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const resolved = resolveAttachmentHref(value, baseUrl);
      if (resolved === value) continue;
      el.setAttribute(attr, resolved);
      const parent = el.parentElement;
      if (
        parent?.tagName.toLowerCase() === "a" &&
        parent.getAttribute("href") === value
      ) {
        parent.setAttribute("href", resolved);
      }
    }
    if (el.tagName.toLowerCase() === "img" && !el.hasAttribute("loading")) {
      el.setAttribute("loading", "lazy");
    }
  });
}

function parseHtmlDocument(text: string): Document | null {
  const Parser =
    typeof DOMParser !== "undefined"
      ? DOMParser
      : (getWindow() as
          | (Window & { DOMParser?: typeof DOMParser })
          | undefined)?.DOMParser;
  if (!Parser) return null;
  return new Parser().parseFromString(text, "text/html");
}

function getDocument(): Document | null {
  if (typeof document !== "undefined") return document;
  return getWindow()?.document ?? null;
}

function getWindow(): Window | undefined {
  return (globalThis as typeof globalThis & { window?: Window }).window;
}

function pinHtmlCspMeta(): string {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(
    PIN_HTML_CSP,
  )}">`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
