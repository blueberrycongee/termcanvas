import path from "node:path";
import { marked } from "marked";
import type { Pin } from "../shared/pin";

export const PIN_RENDER_DEFAULT_WIDTH = 1280;
export const PIN_RENDER_DEFAULT_HEIGHT = 900;
export const PIN_RENDER_MIN_WIDTH = 320;
export const PIN_RENDER_MIN_HEIGHT = 240;
export const PIN_RENDER_MAX_WIDTH = 3840;
export const PIN_RENDER_MAX_HEIGHT = 4096;
export const PIN_RENDER_DEFAULT_WAIT_MS = 300;
export const PIN_RENDER_MAX_WAIT_MS = 5000;

const HTML_DOCUMENT_RE =
  /^\s*(?:<!doctype\s+html[^>]*>|<html[\s>]|<head[\s>]|<body[\s>])/i;
const PIN_RENDER_CSP = [
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

export interface PinRenderOptionsInput {
  outputPath?: string;
  width?: unknown;
  height?: unknown;
  waitMs?: unknown;
  fullPage?: unknown;
}

export interface NormalizedPinRenderOptions {
  outputPath: string;
  width: number;
  height: number;
  waitMs: number;
  fullPage: boolean;
}

export function isPinHtmlDocument(text: string): boolean {
  return HTML_DOCUMENT_RE.test(text);
}

export function getDefaultPinRenderPath(repo: string, pinId: string): string {
  return path.join(repo, ".termcanvas", "pin-renders", pinId, "latest.png");
}

export function normalizePinRenderOptions(
  repo: string,
  pinId: string,
  input: PinRenderOptionsInput = {},
): NormalizedPinRenderOptions {
  return {
    outputPath: path.resolve(
      typeof input.outputPath === "string" && input.outputPath.trim()
        ? input.outputPath
        : getDefaultPinRenderPath(repo, pinId),
    ),
    width: clampInteger(
      input.width,
      PIN_RENDER_DEFAULT_WIDTH,
      PIN_RENDER_MIN_WIDTH,
      PIN_RENDER_MAX_WIDTH,
    ),
    height: clampInteger(
      input.height,
      PIN_RENDER_DEFAULT_HEIGHT,
      PIN_RENDER_MIN_HEIGHT,
      PIN_RENDER_MAX_HEIGHT,
    ),
    waitMs: clampInteger(
      input.waitMs,
      PIN_RENDER_DEFAULT_WAIT_MS,
      0,
      PIN_RENDER_MAX_WAIT_MS,
    ),
    fullPage: input.fullPage === true,
  };
}

export function buildPinRenderHtml(pin: Pin): string {
  const baseUrl = normalizeAttachmentsUrl(pin.attachmentsUrl);
  if (isPinHtmlDocument(pin.body)) {
    return prepareHtmlDocument(pin.body, baseUrl);
  }

  const rendered = marked.parse(pin.body, {
    async: false,
    breaks: true,
  }) as string;
  const body = rewriteRelativeAttachmentMedia(rendered, baseUrl);
  const title = escapeHtml(pin.title || "Pin");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    pinRenderCspMeta(),
    `<title>${title}</title>`,
    "<style>",
    "body{margin:0;background:#fff;color:#111;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
    "main{box-sizing:border-box;max-width:840px;margin:0 auto;padding:32px;}",
    "img,svg,video,canvas{max-width:100%;height:auto;}",
    "pre{overflow:auto;padding:12px;background:#f6f8fa;border-radius:6px;}",
    "code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
    "table{border-collapse:collapse;width:100%;}td,th{border:1px solid #d0d7de;padding:6px 8px;}",
    "</style>",
    "</head>",
    `<body><main>${body}</main></body>`,
    "</html>",
  ].join("");
}

function prepareHtmlDocument(text: string, baseUrl: string | null): string {
  let html = text;
  html = html.replace(/<base\b[^>]*>/gi, "");
  html = html.replace(
    /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
    "",
  );
  html = rewriteRelativeAttachmentMedia(html, baseUrl);

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>${pinRenderCspMeta()}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b([^>]*)>/i,
      `<html$1><head>${pinRenderCspMeta()}</head>`,
    );
  }
  return `<!doctype html><html><head>${pinRenderCspMeta()}</head>${html}</html>`;
}

function rewriteRelativeAttachmentMedia(
  html: string,
  baseUrl: string | null,
): string {
  if (!baseUrl) return html;
  return html.replace(
    /\b(src|poster|href)\s*=\s*(["'])(\.\/[^"']+)\2/gi,
    (full, attr: string, quote: string, value: string) => {
      const resolved = resolveAttachmentHref(value, baseUrl);
      return resolved === value ? full : `${attr}=${quote}${escapeAttr(resolved)}${quote}`;
    },
  );
}

function resolveAttachmentHref(href: string, baseUrl: string | null): string {
  if (!baseUrl) return href;
  if (!href.startsWith("./")) return href;
  const segments = href.slice(2).split("/");
  const basename = segments[segments.length - 1];
  if (!basename) return href;
  return `${baseUrl}/${encodeURIComponent(basename)}`;
}

function normalizeAttachmentsUrl(attachmentsUrl: string | undefined): string | null {
  return attachmentsUrl ? attachmentsUrl.replace(/\/$/, "") : null;
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function pinRenderCspMeta(): string {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(
    PIN_RENDER_CSP,
  )}">`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
